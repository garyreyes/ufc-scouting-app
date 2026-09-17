import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchFlagsForFights } from "./fetchFlagsForFights";

interface Row {
  id: string;
  fight_id: string;
  fighter_id: string;
  category: string;
  retracted_at: string | null;
}

function fakeSupabase(flags: Row[], sources: { flag_id: string }[]) {
  const capturedFilters: { table: string; eq: [string, unknown][]; in: [string, unknown][] }[] = [];

  function builder(table: string, rows: unknown[]) {
    const state = { table, eq: [] as [string, unknown][], in: [] as [string, unknown][] };
    const chain = {
      eq: (col: string, val: unknown) => {
        state.eq.push([col, val]);
        return chain;
      },
      in: (col: string, vals: unknown[]) => {
        state.in.push([col, vals]);
        return chain;
      },
      is: (col: string, val: unknown) => {
        state.eq.push([col, val]); // treat is(col, null) like eq for filtering purposes below
        return chain;
      },
      then: (resolve: (r: { data: unknown; error: null }) => void) => {
        capturedFilters.push(state);
        let filtered = rows;
        for (const [col, val] of state.in) {
          filtered = filtered.filter((r) => (val as unknown[]).includes((r as Record<string, unknown>)[col]));
        }
        for (const [col, val] of state.eq) {
          filtered = filtered.filter((r) => (r as Record<string, unknown>)[col] === val);
        }
        resolve({ data: filtered, error: null });
      },
    };
    return chain;
  }

  const client = {
    from: (table: string) => ({
      select: () => builder(table, table === "rumour_flags" ? flags : sources),
    }),
  } as unknown as SupabaseClient;

  return { client, capturedFilters };
}

describe("fetchFlagsForFights", () => {
  it("returns an open flag with its real corroboration count", async () => {
    const { client } = fakeSupabase(
      [{ id: "flag-1", fight_id: "fight-1", fighter_id: "f1", category: "weight_cut", retracted_at: null }],
      [{ flag_id: "flag-1" }, { flag_id: "flag-1" }],
    );

    const result = await fetchFlagsForFights(client, ["fight-1"]);

    expect(result).toEqual([{ fightId: "fight-1", fighterId: "f1", category: "weight_cut", corroborationCount: 2 }]);
  });

  // The whole reason N3 exists: a retracted flag must never feed
  // flagPenalty() again -- estimated_probability is correctness-critical
  // (ARCHITECTURE.md item #2), so this is the one behavioural change that
  // matters most in the entire retraction feature.
  it("excludes a retracted flag entirely -- it must not contribute to flagPenalty()", async () => {
    const { client } = fakeSupabase(
      [
        { id: "flag-1", fight_id: "fight-1", fighter_id: "f1", category: "weight_cut", retracted_at: null },
        {
          id: "flag-2",
          fight_id: "fight-1",
          fighter_id: "f1",
          category: "injury",
          retracted_at: "2026-09-17T00:00:00Z",
        },
      ],
      [{ flag_id: "flag-1" }, { flag_id: "flag-2" }, { flag_id: "flag-2" }, { flag_id: "flag-2" }],
    );

    const result = await fetchFlagsForFights(client, ["fight-1"]);

    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("weight_cut");
  });

  it("returns an empty array for an empty fightIds list without querying", async () => {
    const { client, capturedFilters } = fakeSupabase([], []);

    const result = await fetchFlagsForFights(client, []);

    expect(result).toEqual([]);
    expect(capturedFilters).toHaveLength(0);
  });

  it("returns an empty array when a fight has no flags at all", async () => {
    const { client } = fakeSupabase([], []);

    const result = await fetchFlagsForFights(client, ["fight-1"]);

    expect(result).toEqual([]);
  });
});
