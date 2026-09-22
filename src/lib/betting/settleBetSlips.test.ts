import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { settleBetSlips } from "./settleBetSlips";

interface SlipRow {
  id: string;
  stake_php: number;
  status: string;
  payout_php: number | null;
  settled_at: string | null;
}

interface LegRow {
  id: string;
  slip_id: string;
  fight_id: string | null;
  market: string;
  selection_fighter_id: string | null;
  method_group: string | null;
  price: number;
  leg_result: string;
  settled_at: string | null;
}

interface FightRow {
  id: string;
  winner_id: string | null;
  method: string | null;
  settled_at: string | null;
  settled_from: string | null;
}

const ROW_CAP = 1000;

function fakeSupabase(seed: { slips: SlipRow[]; legs: LegRow[]; fights: FightRow[] }) {
  const slips = [...seed.slips];
  const legs = [...seed.legs];
  const fights = [...seed.fights];
  const ledgerInserts: Record<string, unknown>[] = [];
  const slipUpdates: { id: string; payload: Record<string, unknown> }[] = [];
  const legUpdates: { id: string; payload: Record<string, unknown> }[] = [];

  function selectable<T extends { id: string }>(rows: T[]) {
    return () => {
      let eqCol: string | null = null;
      let eqVal: unknown;
      let inCol: string | null = null;
      let inVals: readonly string[] = [];
      let gtValue: string | null = null;
      let limitValue = ROW_CAP;
      const builder = {
        eq(col: string, val: unknown) {
          eqCol = col;
          eqVal = val;
          return builder;
        },
        in(col: string, vals: readonly string[]) {
          inCol = col;
          inVals = vals;
          return builder;
        },
        order() {
          return builder;
        },
        gt(_c: string, v: string) {
          gtValue = v;
          return builder;
        },
        limit(n: number) {
          limitValue = Math.min(limitValue, n);
          return builder;
        },
        then(resolve: (result: { data: T[]; error: null }) => void) {
          let filtered = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
          if (eqCol) filtered = filtered.filter((r) => (r as unknown as Record<string, unknown>)[eqCol!] === eqVal);
          if (inCol) filtered = filtered.filter((r) => inVals.includes((r as unknown as Record<string, unknown>)[inCol!] as string));
          if (gtValue !== null) filtered = filtered.filter((r) => r.id > (gtValue as string));
          resolve({ data: filtered.slice(0, limitValue), error: null });
        },
      };
      return builder;
    };
  }

  function updatable<T extends { id: string }>(rows: T[], recorded: { id: string; payload: Record<string, unknown> }[]) {
    return (payload: Record<string, unknown>) => ({
      eq(_c: string, id: string) {
        const row = rows.find((r) => r.id === id);
        if (row) Object.assign(row, payload);
        recorded.push({ id, payload });
        return Promise.resolve({ error: null });
      },
    });
  }

  const client = {
    from(table: "bet_slips" | "bet_legs" | "fights" | "bankroll_ledger") {
      if (table === "bet_slips") {
        return { select: selectable(slips), update: updatable(slips, slipUpdates) };
      }
      if (table === "bet_legs") {
        return { select: selectable(legs), update: updatable(legs, legUpdates) };
      }
      if (table === "bankroll_ledger") {
        return {
          insert(payload: Record<string, unknown>) {
            ledgerInserts.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      }
      return { select: selectable(fights) };
    },
  };

  return { client: client as unknown as SupabaseClient, slips, legs, ledgerInserts, slipUpdates, legUpdates };
}

function slip(n: number, overrides: Partial<SlipRow> = {}): SlipRow {
  return { id: `slip-${n}`, stake_php: 100, status: "open", payout_php: null, settled_at: null, ...overrides };
}

function leg(n: number, overrides: Partial<LegRow> = {}): LegRow {
  return {
    id: `leg-${n}`,
    slip_id: `slip-${n}`,
    fight_id: `fight-${n}`,
    market: "MONEYLINE",
    selection_fighter_id: "winner",
    method_group: null,
    price: 2,
    leg_result: "pending",
    settled_at: null,
    ...overrides,
  };
}

function settledFight(n: number, overrides: Partial<FightRow> = {}): FightRow {
  return { id: `fight-${n}`, winner_id: "winner", method: "Decision (unanimous)", settled_at: "2026-09-22T00:00:00Z", settled_from: null, ...overrides };
}

describe("settleBetSlips", () => {
  it("settles a single-leg moneyline win: leg result, slip payout, and one ledger row", async () => {
    const { client, ledgerInserts, slipUpdates, legUpdates } = fakeSupabase({
      slips: [slip(1)],
      legs: [leg(1, { price: 2 })],
      fights: [settledFight(1)],
    });

    const summary = await settleBetSlips(client);

    expect(summary).toEqual({ slipsSettled: 1, legsSettled: 1 });
    expect(legUpdates[0].payload).toMatchObject({ leg_result: "won" });
    expect(slipUpdates[0].payload).toMatchObject({ status: "won", payout_php: 200 });
    expect(ledgerInserts).toHaveLength(1);
    expect(ledgerInserts[0]).toMatchObject({ kind: "slip_settlement", amount_php: 100, slip_id: "slip-1" });
  });

  it("a parlay dies the moment one leg loses, even with other legs still pending", async () => {
    const { client, slipUpdates } = fakeSupabase({
      slips: [slip(1, { stake_php: 50 })],
      legs: [
        leg(1, { id: "leg-1a", price: 1.5, selection_fighter_id: "loser" }),
        leg(1, { id: "leg-1b", fight_id: "fight-1b", price: 3 }),
      ],
      fights: [settledFight(1), settledFight(1, { id: "fight-1b", settled_at: null })],
    });

    const summary = await settleBetSlips(client);

    expect(summary.slipsSettled).toBe(1);
    expect(slipUpdates[0].payload).toMatchObject({ status: "lost", payout_php: 0 });
  });

  it("leaves a slip open when its only leg is undetermined (no fight row / unresolved fight)", async () => {
    const { client, slipUpdates, legUpdates } = fakeSupabase({
      slips: [slip(1)],
      legs: [leg(1, { fight_id: null, market: "OTHER" })],
      fights: [],
    });

    const summary = await settleBetSlips(client);

    expect(summary).toEqual({ slipsSettled: 0, legsSettled: 0 });
    expect(slipUpdates).toHaveLength(0);
    expect(legUpdates).toHaveLength(0);
  });

  it("reuses an already-settled leg's stored result without rewriting it", async () => {
    const { client, legUpdates, slipUpdates } = fakeSupabase({
      slips: [slip(1, { stake_php: 100 })],
      legs: [
        leg(1, { id: "leg-1a", leg_result: "won", settled_at: "2026-09-21T00:00:00Z", price: 1.5 }),
        leg(1, { id: "leg-1b", fight_id: "fight-1b", price: 2 }),
      ],
      fights: [settledFight(1), settledFight(1, { id: "fight-1b" })],
    });

    const summary = await settleBetSlips(client);

    // Only the still-pending leg gets a write -- the already-won leg-1a is
    // never touched.
    expect(legUpdates).toHaveLength(1);
    expect(legUpdates[0].id).toBe("leg-1b");
    expect(summary.slipsSettled).toBe(1);
    // Combined price is 1.5 * 2 = 3 on a 100 stake.
    expect(slipUpdates[0].payload).toMatchObject({ status: "won", payout_php: 300 });
  });

  it("does nothing when there are no open slips", async () => {
    const { client } = fakeSupabase({ slips: [], legs: [], fights: [] });
    const summary = await settleBetSlips(client);
    expect(summary).toEqual({ slipsSettled: 0, legsSettled: 0 });
  });
});
