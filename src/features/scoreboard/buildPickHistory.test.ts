import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPickHistory, type SettledFightRow, type SettledPickRow } from "./api";

// A minimal fake of the two `.from(table).select(cols).in(col, ids)`
// reads buildPickHistory makes (events, fighters). Each is awaited
// directly, so the builder is a thenable.
function fakeSupabase(tables: Record<string, unknown[]>): SupabaseClient {
  return {
    from(table: string) {
      return {
        select() {
          return {
            in() {
              return Promise.resolve({ data: tables[table] ?? [], error: null });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

const FIGHT: SettledFightRow = {
  id: "ft1",
  event_id: "ev1",
  fighter1_id: "fa",
  fighter2_id: "fb",
  winner_id: "fa",
  weight_class: "Lightweight",
  settled_at: "2026-01-02T00:00:00Z",
};

const supabase = fakeSupabase({
  events: [{ id: "ev1", name: "UFC 300", event_date: "2026-01-01" }],
  fighters: [
    { id: "fa", name: "Alice", stance: "Orthodox" },
    { id: "fb", name: "Bob", stance: "Southpaw" },
  ],
});

const oddsByFightId = new Map([["ft1", { fighter1_price: 1.5, fighter2_price: 2.6 }]]);

// PostgREST serialises numeric columns as JSON strings. The row shape
// the real query hands back therefore carries stake_units / pnl_units /
// estimated_probability as strings, even though SettledPickRow types
// them as numbers -- that mismatch is exactly what this guards.
function settledPick(overrides: Partial<Record<keyof SettledPickRow, unknown>>): SettledPickRow {
  return {
    id: "pk1",
    author: "USER",
    fight_id: "ft1",
    predicted_fighter_id: "fa",
    estimated_probability: "0.6100",
    pick_correct: true,
    bet_fighter_id: "fa",
    stake_units: "1.50",
    pnl_units: "0.75",
    settled_at: "2026-01-02T00:00:00Z",
    ...overrides,
  } as SettledPickRow;
}

describe("buildPickHistory numeric conversion", () => {
  it("returns stake_units and pnl_units as numbers, not the strings PostgREST sends", async () => {
    const rows = await buildPickHistory(supabase, [FIGHT], [settledPick({})], oddsByFightId);

    expect(rows).toHaveLength(1);
    expect(rows[0].stakeUnits).toBe(1.5);
    expect(rows[0].pnlUnits).toBe(0.75);
    expect(typeof rows[0].stakeUnits).toBe("number");
    expect(typeof rows[0].pnlUnits).toBe("number");
  });

  it("keeps null for a pick with no bet", async () => {
    const rows = await buildPickHistory(
      supabase,
      [FIGHT],
      [settledPick({ bet_fighter_id: null, stake_units: null, pnl_units: null })],
      oddsByFightId,
    );

    expect(rows[0].stakeUnits).toBeNull();
    expect(rows[0].pnlUnits).toBeNull();
  });

  it("a row's pnlUnits survives summing -- string concat would corrupt the units line", async () => {
    const rows = await buildPickHistory(
      supabase,
      [FIGHT],
      [
        settledPick({ id: "pk1", pnl_units: "0.75" }),
        settledPick({ id: "pk2", pnl_units: "-1.00" }),
      ],
      oddsByFightId,
    );

    const net = rows.reduce((sum, r) => sum + (r.pnlUnits ?? 0), 0);
    expect(net).toBeCloseTo(-0.25, 10);
  });
});
