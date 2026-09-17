import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchUnpricedFights } from "./eligibleUnpricedFights";

interface FightRow {
  id: string;
  fighter1: { name: string };
  fighter2: { name: string };
  event: { event_date: string; starts_at: string | null };
}

interface OddsRow {
  id: string;
  fight_id: string;
}

// The real PostgREST row cap this bug lives against -- see
// selectAllPages.ts's own header comment. A table with fewer rows than
// this can never exercise the truncation this test exists to catch.
const ROW_CAP = 1000;

/**
 * A fake `.from(table).select(cols)` chain that enforces the SAME silent
 * truncation PostgREST's `db-max-rows` setting does live: a plain,
 * unpaged select returns at most `ROW_CAP` rows, with no error -- exactly
 * what made the real production bug (44 fights invisible to odds
 * matching) look like a complete, successful read. `.order()`/`.gt()`
 * make the fake behave like `selectAllPages`'s real keyset pagination so
 * the fix under test is exercised for real, not just type-checked.
 */
function fakeSupabase(tables: { fights: FightRow[]; odds_snapshots: OddsRow[] }): SupabaseClient {
  return {
    from(table: "fights" | "odds_snapshots") {
      const allRows = [...tables[table]].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return {
        select() {
          let gtValue: string | null = null;
          let limitValue = ROW_CAP; // an unpaged select still hits the real server-side cap
          const builder = {
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
            then(resolve: (result: { data: unknown[]; error: null }) => void) {
              let rows = allRows;
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

function makeFight(n: number): FightRow {
  return {
    id: String(n).padStart(6, "0"),
    fighter1: { name: `Fighter1-${n}` },
    fighter2: { name: `Fighter2-${n}` },
    event: { event_date: "2026-09-12", starts_at: null },
  };
}

describe("fetchUnpricedFights", () => {
  it("returns every unpriced fight even when the table has more rows than PostgREST's page cap", async () => {
    // 1,050 fights (today's real production count is 1,044), 3 already
    // priced -- so the correct answer is exactly 1,047, not 1,000.
    const fights = Array.from({ length: 1050 }, (_, i) => makeFight(i));
    const pricedIds = [fights[0].id, fights[500].id, fights[1049].id];
    const oddsSnapshots: OddsRow[] = pricedIds.map((id, i) => ({ id: `snap-${i}`, fight_id: id }));

    const supabase = fakeSupabase({ fights, odds_snapshots: oddsSnapshots });
    const result = await fetchUnpricedFights(supabase);

    expect(result).toHaveLength(1047);
    const resultIds = new Set(result.map((f) => f.id));
    for (const pricedId of pricedIds) {
      expect(resultIds.has(pricedId)).toBe(false);
    }
    // Specifically: a fight past row 1000 (the real bug's blind spot) must
    // still come back.
    expect(resultIds.has(fights[1010].id)).toBe(true);
  });

  it("returns every fight unpriced when nothing has been priced yet", async () => {
    const fights = [makeFight(1), makeFight(2)];
    const supabase = fakeSupabase({ fights, odds_snapshots: [] });

    const result = await fetchUnpricedFights(supabase);

    expect(result.map((f) => f.id).sort()).toEqual([fights[0].id, fights[1].id].sort());
  });
});
