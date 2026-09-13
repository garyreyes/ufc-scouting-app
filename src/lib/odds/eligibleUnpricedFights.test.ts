import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchUnpricedFights } from "./eligibleUnpricedFights";

interface FightRow {
  id: string;
  settled_at: string | null;
  fighter1: { name: string };
  fighter2: { name: string };
  event: { event_date: string; starts_at: string | null };
}

function fakeSupabase(fights: FightRow[], pricedFightIds: string[] = []) {
  const client = {
    from(table: "fights" | "odds_snapshots") {
      if (table === "odds_snapshots") {
        return {
          select() {
            return Promise.resolve({ data: pricedFightIds.map((fight_id) => ({ fight_id })), error: null });
          },
        };
      }
      return {
        select() {
          let isCol: string | null = null;
          let isVal: unknown = undefined;
          const builder = {
            is(col: string, val: unknown) {
              isCol = col;
              isVal = val;
              return builder;
            },
            then(resolve: (r: { data: FightRow[]; error: null }) => void) {
              const rows = isCol
                ? fights.filter((f) => (f as unknown as Record<string, unknown>)[isCol!] === isVal)
                : fights;
              resolve({ data: rows, error: null });
            },
          };
          return builder;
        },
      };
    },
  };
  return client as unknown as SupabaseClient;
}

function fight(overrides: Partial<FightRow> = {}): FightRow {
  return {
    id: "fight-1",
    settled_at: null,
    fighter1: { name: "Fighter A" },
    fighter2: { name: "Fighter B" },
    event: { event_date: "2026-09-12", starts_at: null },
    ...overrides,
  };
}

describe("fetchUnpricedFights", () => {
  it("excludes a cancelled fight -- it will never need a price", () => {
    const upcoming = fight({ id: "upcoming" });
    const cancelled = fight({ id: "cancelled", settled_at: "2026-09-14T06:00:00Z" });

    return fetchUnpricedFights(fakeSupabase([upcoming, cancelled])).then((result) => {
      expect(result.map((f) => f.id)).toEqual(["upcoming"]);
    });
  });

  it("still excludes an already-priced fight", async () => {
    const priced = fight({ id: "priced" });
    const unpriced = fight({ id: "unpriced" });

    const result = await fetchUnpricedFights(fakeSupabase([priced, unpriced], ["priced"]));
    expect(result.map((f) => f.id)).toEqual(["unpriced"]);
  });
});
