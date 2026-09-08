import type { SupabaseClient } from "@supabase/supabase-js";

// PostgREST can cap a single response (db-max-rows), and when it does it
// returns a SHORT LIST WITH NO ERROR. That is the whole reason this
// helper exists: a truncated read looks exactly like a complete one, so
// every whole-table scan in this codebase is one row-count away from
// silently computing the wrong answer.
const PAGE_SIZE = 1000;

/**
 * The subset of PostgREST's filter builder `selectAllPages`'s `filter`
 * hook is allowed to touch -- row narrowing only. Declared structurally
 * rather than importing PostgrestFilterBuilder, whose generics are deep
 * enough to trip "Type instantiation is excessively deep" here.
 */
export interface PageQueryNarrowing {
  eq(column: string, value: unknown): PageQueryNarrowing;
  gt(column: string, value: unknown): PageQueryNarrowing;
  gte(column: string, value: unknown): PageQueryNarrowing;
  lt(column: string, value: unknown): PageQueryNarrowing;
  lte(column: string, value: unknown): PageQueryNarrowing;
  in(column: string, values: readonly unknown[]): PageQueryNarrowing;
  is(column: string, value: unknown): PageQueryNarrowing;
  not(column: string, operator: string, value: unknown): PageQueryNarrowing;
}

/**
 * Reads an entire table, one page at a time.
 *
 * **Use this instead of a bare `.select()` for any query meant to return
 * a whole table.** Introduced in I5 for the record recount, and applied
 * to recomputeEloRatings.ts in the same pass once it became clear that
 * function had been carrying the same exposure: `fights` passed ~950
 * rows during the I4 backfill, so both were within one event of quietly
 * rating and counting an incomplete graph.
 *
 * **Keyset pagination by `id`, not offset (`.range()`).** The first cut
 * of this helper used `.range()` + `count: "exact"`, and a review caught
 * the real gap in that design: an offset is positional, so a row
 * inserted or deleted by a concurrent job (the fighter-enrichment job
 * and both daily syncs all write while these tables are being scanned)
 * shifts every later page by one -- silently skipping or double-reading
 * a row, with `count` still landing on a number that looks correct.
 * Ordering by `id` alone does not fix this: it only makes a single page
 * stable, not the sequence of pages across writes in between. Filtering
 * the next page to `id > <last id on this page>` does fix it, because it
 * is anchored to a row already read rather than to a shifting position
 * -- a row inserted anywhere is simply picked up (or correctly missed,
 * if inserted behind the cursor) rather than corrupting the pages ahead
 * of it. `columns` must therefore always include `id`, and the table
 * must have one (every table in this schema does).
 *
 * Termination is a short (or empty) page, not a separate count query --
 * simpler, and the resulting id filter is exact, not a number taken
 * before the last page was actually read.
 *
 * Callers pass whatever client they already hold: this only reads, so it
 * works through the public client for anon-readable tables and the admin
 * client for everything else.
 *
 * `filter` is an optional narrowing hook -- `(q) => q.gte("event_date",
 * today)` or `.in("event_id", ids)`. It must ONLY add row filters (`.eq`
 * / `.gte` / `.lt` / `.in` / `.is` / `.not`) -- an `.order()` or
 * `.limit()` of its own would fight the keyset pagination this helper
 * applies (order by `id`, limit 1000, cursor `id > last`). Row filters
 * compose order-independently with that, so it is applied right after
 * the base query is built. `columns` must still include `id`, filtered
 * or not, since the cursor is `id`.
 */
export async function selectAllPages<T extends { id: string }>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  filter?: (query: PageQueryNarrowing) => PageQueryNarrowing,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;

  for (;;) {
    let query = supabase.from(table).select(columns).order("id", { ascending: true }).limit(PAGE_SIZE);
    if (filter) {
      query = filter(query as unknown as PageQueryNarrowing) as unknown as typeof query;
    }
    if (cursor !== null) query = query.gt("id", cursor);

    const { data, error } = await query;
    if (error) throw error;

    const page = (data ?? []) as unknown as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
    cursor = page[page.length - 1].id;
  }
}
