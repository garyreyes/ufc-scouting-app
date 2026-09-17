import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { settlePicks } from "./settlePicks";

interface PickRow {
  id: string;
  fight_id: string;
  predicted_fighter_id: string;
  bet_fighter_id: string | null;
  stake_units: number | null;
  settled_at: string | null;
  pick_correct: boolean | null;
  pnl_units: number | null;
}

interface FightRow {
  id: string;
  fighter1_id: string;
  fighter2_id: string;
  winner_id: string | null;
  settled_at: string | null;
}

interface OddsRow {
  id: string;
  fight_id: string;
  fighter1_price: number;
  fighter2_price: number;
}

const ROW_CAP = 1000;

/**
 * Covers every table settlePicks reads/writes, with the same ROW_CAP
 * truncation PostgREST applies to a plain unpaged select, and with `.in()`
 * calls recorded so the test can assert they were split into chunks
 * rather than sent as one oversized list.
 */
function fakeSupabase(seed: { picks: PickRow[]; fights: FightRow[]; odds: OddsRow[] }) {
  const picks = [...seed.picks];
  const fights = [...seed.fights];
  const odds = [...seed.odds];
  const inCalls: { table: string; column: string; values: string[] }[] = [];
  const pickUpdates: { id: string; payload: Record<string, unknown> }[] = [];

  function selectable<T extends { id: string }>(rows: T[], table: string) {
    return () => {
      let isCol: string | null = null;
      let isVal: unknown = undefined;
      let inCol: string | null = null;
      let inVals: readonly string[] = [];
      let gtValue: string | null = null;
      let limitValue = ROW_CAP;
      const builder = {
        is(col: string, val: unknown) {
          isCol = col;
          isVal = val;
          return builder;
        },
        in(col: string, vals: readonly string[]) {
          inCol = col;
          inVals = vals;
          inCalls.push({ table, column: col, values: [...vals] });
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
          if (isCol) filtered = filtered.filter((r) => (r as unknown as Record<string, unknown>)[isCol!] === isVal);
          if (inCol) filtered = filtered.filter((r) => inVals.includes((r as unknown as Record<string, unknown>)[inCol!] as string));
          if (gtValue !== null) filtered = filtered.filter((r) => r.id > (gtValue as string));
          resolve({ data: filtered.slice(0, limitValue), error: null });
        },
      };
      return builder;
    };
  }

  const client = {
    from(table: "picks" | "fights" | "odds_snapshots") {
      if (table === "picks") {
        return {
          select: selectable(picks, "picks"),
          update(payload: Record<string, unknown>) {
            return {
              eq(_c: string, id: string) {
                const row = picks.find((p) => p.id === id);
                if (row) Object.assign(row, payload);
                pickUpdates.push({ id, payload });
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }
      if (table === "fights") return { select: selectable(fights, "fights") };
      return { select: selectable(odds, "odds_snapshots") };
    },
  };

  return { client: client as unknown as SupabaseClient, picks, pickUpdates, inCalls };
}

function pick(n: number, overrides: Partial<PickRow> = {}): PickRow {
  return {
    id: `pick-${n}`,
    fight_id: `fight-${n}`,
    predicted_fighter_id: "winner",
    bet_fighter_id: null,
    stake_units: null,
    settled_at: null,
    pick_correct: null,
    pnl_units: null,
    ...overrides,
  };
}

describe("settlePicks", () => {
  it("settles every unsettled pick even past PostgREST's row cap", async () => {
    // 1,010 unsettled picks, each on its own already-settled fight -- a
    // plain unpaged read of `picks` would silently stop at 1,000.
    const picks = Array.from({ length: 1010 }, (_, i) => pick(i));
    const fights = picks.map((p) => ({
      id: p.fight_id,
      fighter1_id: "winner",
      fighter2_id: "loser",
      winner_id: "winner",
      settled_at: "2026-09-13T00:00:00Z",
    }));

    const { client, pickUpdates } = fakeSupabase({ picks, fights, odds: [] });
    const summary = await settlePicks(client);

    expect(summary.picksSettled).toBe(1010);
    expect(pickUpdates).toHaveLength(1010);
    expect(pickUpdates.every((u) => u.payload.pick_correct === true)).toBe(true);
  });

  it("chunks the fight and odds lookups instead of sending one oversized .in() list", async () => {
    // 250 unsettled picks with bets, each needing both a fight row and an
    // odds row -- large enough to force multiple chunks at the shared
    // DEFAULT_CHUNK_SIZE (100), small enough to keep the test fast.
    const picks = Array.from({ length: 250 }, (_, i) =>
      pick(i, { bet_fighter_id: "winner", stake_units: 1 }),
    );
    const fights = picks.map((p) => ({
      id: p.fight_id,
      fighter1_id: "winner",
      fighter2_id: "loser",
      winner_id: "winner",
      settled_at: "2026-09-13T00:00:00Z",
    }));
    const odds = picks.map((p) => ({
      id: `odds-${p.fight_id}`,
      fight_id: p.fight_id,
      fighter1_price: 1.5,
      fighter2_price: 2.5,
    }));

    const { client, inCalls, pickUpdates } = fakeSupabase({ picks, fights, odds });
    const summary = await settlePicks(client);

    expect(summary.picksSettled).toBe(250);
    const fightsCalls = inCalls.filter((c) => c.table === "fights");
    const oddsCalls = inCalls.filter((c) => c.table === "odds_snapshots");
    // 250 ids at the shared chunk size (100) is 3 calls, none oversized.
    expect(fightsCalls.length).toBeGreaterThan(1);
    expect(oddsCalls.length).toBeGreaterThan(1);
    for (const call of [...fightsCalls, ...oddsCalls]) {
      expect(call.values.length).toBeLessThanOrEqual(100);
    }
    expect(pickUpdates.every((u) => typeof u.payload.pnl_units === "number")).toBe(true);
  });

  it("does nothing when there are no unsettled picks", async () => {
    const { client } = fakeSupabase({ picks: [], fights: [], odds: [] });
    const summary = await settlePicks(client);
    expect(summary).toEqual({ picksSettled: 0, fightsProcessed: 0 });
  });
});
