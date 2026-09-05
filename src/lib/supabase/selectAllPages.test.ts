import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllPages } from "./selectAllPages";

interface Row {
  id: string;
}

// The module's real PAGE_SIZE is 1000 and not exported, so a genuine
// multi-page test needs that many rows -- trivial in memory, and the
// only way to actually exercise the loop boundary rather than asserting
// it by inspection.
const PAGE_SIZE = 1000;

function padId(n: number): string {
  return String(n).padStart(6, "0");
}

/**
 * A minimal fake of the `.from().select().order().gt().limit()` chain,
 * backed by whatever `getRows()` returns at the moment each page is
 * actually fetched -- not a fixed snapshot taken once. That is what lets
 * the tests below simulate a write landing on the table BETWEEN two page
 * fetches, the exact scenario the real module has to survive.
 */
function fakeSupabase(getRows: () => Row[]): SupabaseClient {
  return {
    from() {
      return {
        select() {
          let gtValue: string | null = null;
          let limitValue = Infinity;
          const builder = {
            order() {
              return builder;
            },
            gt(_column: string, value: string) {
              gtValue = value;
              return builder;
            },
            limit(n: number) {
              limitValue = n;
              return builder;
            },
            then(resolve: (result: { data: Row[]; error: null }) => void) {
              let rows = [...getRows()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
              if (gtValue !== null) rows = rows.filter((r) => r.id > (gtValue as string));
              resolve({ data: rows.slice(0, limitValue), error: null });
            },
          };
          return builder;
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe("selectAllPages", () => {
  it("returns an empty array for an empty table", async () => {
    const result = await selectAllPages(fakeSupabase(() => []), "fighters", "id");
    expect(result).toEqual([]);
  });

  it("returns every row in one page when the table is smaller than the page size", async () => {
    const rows = [{ id: padId(1) }, { id: padId(2) }, { id: padId(3) }];
    const result = await selectAllPages(fakeSupabase(() => rows), "fighters", "id");
    expect(result).toEqual(rows);
  });

  it("assembles multiple pages into one result, in order, with none dropped or repeated", async () => {
    const rows = Array.from({ length: PAGE_SIZE * 2 + 137 }, (_, i) => ({ id: padId(i) }));
    const result = await selectAllPages(fakeSupabase(() => rows), "fights", "id");

    expect(result).toHaveLength(rows.length);
    expect(result.map((r) => r.id)).toEqual(rows.map((r) => r.id));
  });

  it("takes one extra round trip to terminate when the table is an exact multiple of the page size", async () => {
    // A page exactly PAGE_SIZE long is not itself proof of the end --
    // the loop must ask again and see an empty page before stopping.
    // Getting this wrong either drops the last real page or spins
    // forever on a still-full page.
    const rows = Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: padId(i) }));
    const result = await selectAllPages(fakeSupabase(() => rows), "fights", "id");
    expect(result).toHaveLength(PAGE_SIZE);
  });

  it("does not skip an unread row when an earlier row is deleted between page fetches", async () => {
    // This is the scenario offset (.range()) pagination cannot survive,
    // and the reason this module uses a keyset cursor instead. With
    // offset pagination, deleting row 1 shifts every later row's
    // POSITION down by one -- the second page's .range(1000, 1999) would
    // then silently skip whatever row now sits at position 999, one that
    // page 1 never actually read. A keyset cursor filters by the VALUE
    // of the last id already read (id > "000999"), which a deletion
    // elsewhere in the table cannot shift.
    let rows = Array.from({ length: PAGE_SIZE + 500 }, (_, i) => ({ id: padId(i) }));
    let callCount = 0;

    const getRows = () => {
      callCount++;
      if (callCount === 2) {
        // Simulates a concurrent delete of the very first row, landing
        // after page 1 (ids 000000..000999) has already been read and
        // before page 2 is fetched.
        rows = rows.filter((r) => r.id !== padId(0));
      }
      return rows;
    };

    const result = await selectAllPages(fakeSupabase(getRows), "fights", "id");

    // Row 000000 was already inside page 1 before the delete happened,
    // so it correctly survives in the result -- this test is not about
    // that row, it's about every row AFTER the cursor. What matters is
    // that none of 000001..PAGE_SIZE+499 was skipped by the shift an
    // offset-based .range() would have suffered from the deletion.
    const expectedIds = Array.from({ length: PAGE_SIZE + 500 }, (_, i) => padId(i));
    expect(result.map((r) => r.id)).toEqual(expectedIds);
  });

  it("does not duplicate a row when a new row is inserted ahead of the cursor between page fetches", async () => {
    // The mirror case: an insert landing AFTER the already-read cursor
    // (a fresh uuid sorts unpredictably, so this is the common case, not
    // an edge case) must be picked up exactly once by the next page's
    // id > cursor filter, never re-read by the page that already passed
    // it.
    let rows = Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: padId(i) }));
    let callCount = 0;

    const getRows = () => {
      callCount++;
      if (callCount === 2) {
        // Sorts after every existing id ("999999" > "000999"), landing
        // in the unread remainder rather than the page already returned.
        rows = [...rows, { id: "999999" }];
      }
      return rows;
    };

    const result = await selectAllPages(fakeSupabase(getRows), "fights", "id");
    const ids = result.map((r) => r.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("999999");
    expect(ids).toHaveLength(PAGE_SIZE + 1);
  });
});
