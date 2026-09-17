import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllPagesByIds } from "./selectAllPagesByIds";

interface Row {
  id: string;
  fighter_id: string;
}

/**
 * A minimal fake of the `.from().select().in().order().gt().limit()` chain.
 * Records every `.in()` call's value list so tests can assert the ids were
 * actually split into chunks, not sent as one oversized list.
 */
function fakeSupabase(rows: Row[]): { client: SupabaseClient; inCalls: string[][] } {
  const inCalls: string[][] = [];
  const client = {
    from() {
      return {
        select() {
          let inColumn: string | null = null;
          let inValues: readonly string[] = [];
          let gtValue: string | null = null;
          const builder = {
            in(column: string, values: readonly string[]) {
              inColumn = column;
              inValues = values;
              inCalls.push([...values]);
              return builder;
            },
            order() {
              return builder;
            },
            gt(_column: string, value: string) {
              gtValue = value;
              return builder;
            },
            limit() {
              return builder;
            },
            then(resolve: (result: { data: Row[]; error: null }) => void) {
              let filtered = inColumn
                ? rows.filter((r) => inValues.includes(r[inColumn as keyof Row] as string))
                : rows;
              filtered = [...filtered].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
              if (gtValue !== null) filtered = filtered.filter((r) => r.id > (gtValue as string));
              resolve({ data: filtered, error: null });
            },
          };
          return builder;
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, inCalls };
}

describe("selectAllPagesByIds", () => {
  it("returns [] and makes no request when ids is empty", async () => {
    const { client, inCalls } = fakeSupabase([{ id: "a", fighter_id: "f1" }]);
    const result = await selectAllPagesByIds(client, "fighter_sherdog_bouts", "id, fighter_id", "fighter_id", []);
    expect(result).toEqual([]);
    expect(inCalls).toEqual([]);
  });

  it("splits a long id list into chunks and merges every chunk's rows", async () => {
    const rows: Row[] = Array.from({ length: 5 }, (_, i) => ({ id: `row-${i}`, fighter_id: `f${i}` }));
    const { client, inCalls } = fakeSupabase(rows);
    const ids = rows.map((r) => r.fighter_id);

    const result = await selectAllPagesByIds<Row>(
      client,
      "fighter_sherdog_bouts",
      "id, fighter_id",
      "fighter_id",
      ids,
      2, // chunkSize
    );

    // 5 ids at chunk size 2 -> 3 requests, each within the chunk size.
    expect(inCalls).toEqual([
      ["f0", "f1"],
      ["f2", "f3"],
      ["f4"],
    ]);
    expect(result.map((r) => r.id).sort()).toEqual(["row-0", "row-1", "row-2", "row-3", "row-4"]);
  });

  it("only returns rows matching the requested ids, not the whole table", async () => {
    const rows: Row[] = [
      { id: "1", fighter_id: "wanted" },
      { id: "2", fighter_id: "not-wanted" },
    ];
    const { client } = fakeSupabase(rows);

    const result = await selectAllPagesByIds<Row>(client, "fighter_sherdog_bouts", "id, fighter_id", "fighter_id", [
      "wanted",
    ]);

    expect(result).toEqual([{ id: "1", fighter_id: "wanted" }]);
  });
});
