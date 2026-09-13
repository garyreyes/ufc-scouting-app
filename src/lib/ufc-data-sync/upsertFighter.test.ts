import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertFighter } from "./upsertFighter";

interface FighterRow {
  id: string;
  name: string;
  external_id: string | null;
}

const ROW_CAP = 1000;

/**
 * A fake covering every fighters-table operation upsertFighter makes:
 * eq/maybeSingle (external_id lookup), ilike (case-insensitive name
 * lookup), a plain unpaged-looking select (the fold-match scan, now
 * expected to page via selectAllPages), update, and insert. The plain
 * select enforces the same ROW_CAP truncation PostgREST applies live, so
 * a fold-match fix that forgets to page still fails this test.
 */
function fakeSupabase(initialRows: FighterRow[]) {
  const rows: FighterRow[] = [...initialRows];
  const updates: { id: string; payload: Record<string, unknown> }[] = [];
  let nextInsertId = 1;

  const client = {
    from(table: string) {
      if (table !== "fighters") throw new Error(`unexpected table ${table}`);
      return {
        select() {
          let eqCol: string | null = null;
          let eqVal: unknown = null;
          let ilikeVal: string | null = null;
          let gtValue: string | null = null;
          let limitValue = ROW_CAP;

          const sorted = () => [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

          const compute = () => {
            let filtered = sorted();
            if (eqCol) filtered = filtered.filter((r) => (r as unknown as Record<string, unknown>)[eqCol!] === eqVal);
            if (ilikeVal !== null) {
              const needle = ilikeVal.toLowerCase();
              filtered = filtered.filter((r) => r.name.toLowerCase() === needle);
            }
            if (gtValue !== null) filtered = filtered.filter((r) => r.id > (gtValue as string));
            return filtered.slice(0, limitValue);
          };

          const builder = {
            eq(column: string, value: unknown) {
              eqCol = column;
              eqVal = value;
              return builder;
            },
            ilike(_column: string, value: string) {
              ilikeVal = value;
              return builder;
            },
            order() {
              return builder;
            },
            gt(_column: string, value: string) {
              gtValue = value;
              return builder;
            },
            limit(n: number) {
              limitValue = Math.min(limitValue, n);
              return builder;
            },
            maybeSingle() {
              const data = compute();
              if (data.length > 1) {
                return Promise.resolve({
                  data: null,
                  error: { message: "JSON object requested, multiple (or no) rows returned" },
                });
              }
              return Promise.resolve({ data: data[0] ?? null, error: null });
            },
            then(resolve: (result: { data: FighterRow[]; error: null }) => void) {
              resolve({ data: compute(), error: null });
            },
          };
          return builder;
        },
        update(payload: Record<string, unknown>) {
          return {
            eq(_column: string, id: string) {
              const row = rows.find((r) => r.id === id);
              if (row) {
                Object.assign(row, payload);
                updates.push({ id, payload });
              }
              return Promise.resolve({ error: null });
            },
          };
        },
        insert(fighter: { name: string; external_id?: string }) {
          return {
            select() {
              return {
                single() {
                  const row: FighterRow = {
                    id: `new-${nextInsertId++}`,
                    name: fighter.name,
                    external_id: fighter.external_id ?? null,
                  };
                  rows.push(row);
                  return Promise.resolve({ data: { id: row.id }, error: null });
                },
              };
            },
          };
        },
      };
    },
  };

  return { client: client as unknown as SupabaseClient, rows, updates };
}

function padId(n: number): string {
  return `id-${String(n).padStart(6, "0")}`;
}

describe("upsertFighter", () => {
  it("resolves a case-insensitive name collision instead of throwing", async () => {
    // Two rows fold to the same name under `.ilike` -- this used to crash
    // `.maybeSingle()` in production instead of picking a target.
    const { client, rows, updates } = fakeSupabase([
      { id: padId(1), name: "jose delgado", external_id: null },
      { id: padId(2), name: "Jose Delgado", external_id: "2759" },
    ]);

    const id = await upsertFighter(client, { name: "Jose Delgado" });

    // The row carrying an external_id is the canonical identity row.
    expect(id).toBe(padId(2));
    expect(updates).toEqual([{ id: padId(2), payload: { name: "Jose Delgado" } }]);
    expect(rows).toHaveLength(2); // no duplicate inserted
  });

  it("finds an existing fighter past PostgREST's row cap during the fold-match scan", async () => {
    // 1,050 fighters (today's real count is 822 and rising) -- a plain
    // unpaged select would silently return only the first 1,000 and miss
    // this one, inserting a duplicate instead of updating it.
    const rows: FighterRow[] = Array.from({ length: 1050 }, (_, i) => ({
      id: padId(i),
      name: `Filler Fighter ${i}`,
      external_id: null,
    }));
    // The target sits well past row 1000, and its stored name has a
    // structural rewrite (missing space) that only the fold-match path
    // catches -- ilike alone would miss it too.
    rows[1010] = { id: padId(1010), name: "Su Mudaerji", external_id: null };

    const fake = fakeSupabase(rows);

    const id = await upsertFighter(fake.client, { name: "Sumudaerji", external_id: "9999" });

    expect(id).toBe(padId(1010));
    expect(fake.rows).toHaveLength(1050); // updated in place, not duplicated
    expect(fake.updates).toEqual([
      { id: padId(1010), payload: { name: "Sumudaerji", external_id: "9999" } },
    ]);
  });

  it("inserts a genuinely new fighter when no row matches", async () => {
    const { client, rows } = fakeSupabase([{ id: padId(1), name: "Someone Else", external_id: null }]);

    const id = await upsertFighter(client, { name: "Brand New Fighter" });

    expect(rows.find((r) => r.id === id)?.name).toBe("Brand New Fighter");
    expect(rows).toHaveLength(2);
  });
});
