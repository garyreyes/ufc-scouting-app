import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllPages } from "./selectAllPages";
import { chunk, DEFAULT_CHUNK_SIZE } from "./chunk";

/**
 * `selectAllPages` scoped to `idColumn IN (ids)`, with `ids` itself split
 * into chunks first -- so neither failure mode from M1 can recur through
 * this path: a response truncated at PostgREST's row cap, or an `.in()`
 * list long enough to build an oversized request URL. One shared
 * implementation instead of each caller (settlement, Sherdog jobs, the
 * fighters list) reinventing its own chunking loop.
 *
 * Returns [] without any request when `ids` is empty -- several callers
 * derive `ids` from a possibly-empty upstream list.
 */
export async function selectAllPagesByIds<T extends { id: string }>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  idColumn: string,
  ids: readonly string[],
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const rows: T[] = [];
  for (const idChunk of chunk(ids, chunkSize)) {
    const page = await selectAllPages<T>(supabase, table, columns, (q) => q.in(idColumn, idChunk));
    rows.push(...page);
  }
  return rows;
}
