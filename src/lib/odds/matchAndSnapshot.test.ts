import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { matchAndSnapshot } from "./matchAndSnapshot";
import type { OddsEvent } from "./types";

interface FightRow {
  id: string;
  settled_at: string | null;
  fighter1: { name: string };
  fighter2: { name: string };
  event: { event_date: string; starts_at: string | null };
}

interface ConflictRow {
  id: string;
  kind: string;
  resolved_at: string | null;
  details: { oddsEvent: OddsEvent; candidateFightId?: string };
}

// Both `fights` and `odds_snapshots` reads go through selectAllPages now
// (M1) -- the fake must support its real chain (`.order().limit()`, plus
// `.gt()` for the keyset cursor) or it throws before ever reaching the
// `.is()` filter M2 added. Every row is returned in one page here (well
// under selectAllPages' 1000-row cap), so `.gt()`/`.limit()` are no-ops
// in practice but still need to exist on the chain.
function fakePagedTable<T extends { id: string }>(rows: T[]) {
  return {
    select() {
      let isCol: string | null = null;
      let isVal: unknown = undefined;
      const builder = {
        order() {
          return builder;
        },
        gt() {
          return builder;
        },
        limit() {
          return builder;
        },
        is(col: string, val: unknown) {
          isCol = col;
          isVal = val;
          return builder;
        },
        then(resolve: (r: { data: T[]; error: null }) => void) {
          const filtered = isCol
            ? rows.filter((r) => (r as unknown as Record<string, unknown>)[isCol!] === isVal)
            : rows;
          resolve({ data: filtered, error: null });
        },
      };
      return builder;
    },
  };
}

function fakeSupabase(fights: FightRow[], conflicts: ConflictRow[], pricedFightIds: string[] = []) {
  const inserted: { table: string; payload: Record<string, unknown> }[] = [];
  const updated: { table: string; payload: Record<string, unknown>; ids: string[] }[] = [];
  const client = {
    from(table: "fights" | "odds_snapshots" | "data_conflicts") {
      if (table === "fights") {
        return fakePagedTable(fights);
      }
      if (table === "data_conflicts") {
        return {
          select() {
            let onlyUnresolved = false;
            const builder = {
              eq() {
                return builder;
              },
              is(col: string, val: unknown) {
                if (col === "resolved_at" && val === null) onlyUnresolved = true;
                return builder;
              },
              then(resolve: (r: { data: ConflictRow[]; error: null }) => void) {
                // Mirrors a real `.is("resolved_at", null)` filter -- if
                // the implementation applies it, a resolved conflict must
                // NOT come back, exactly like a real Postgres query.
                const rows = onlyUnresolved ? conflicts.filter((c) => c.resolved_at === null) : conflicts;
                resolve({ data: rows, error: null });
              },
            };
            return builder;
          },
          insert(payload: Record<string, unknown>) {
            inserted.push({ table: "data_conflicts", payload });
            return Promise.resolve({ error: null });
          },
          update(payload: Record<string, unknown>) {
            return {
              in(_col: string, ids: string[]) {
                updated.push({ table: "data_conflicts", payload, ids });
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }
      // odds_snapshots
      return {
        ...fakePagedTable<{ id: string; fight_id: string }>(
          pricedFightIds.map((fightId, i) => ({ id: `snap-${i}`, fight_id: fightId })),
        ),
        insert(payload: Record<string, unknown>) {
          inserted.push({ table: "odds_snapshots", payload });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, inserted, updated };
}

const NOW = new Date("2026-09-20T12:00:00Z");
// Well past SNAPSHOT_LEAD_HOURS (12h) before NOW, so isPastSnapshotWindow
// treats every fixture fight as eligible for matching.
const STARTS_AT = "2026-09-20T04:00:00Z";

function fight(overrides: Partial<FightRow> = {}): FightRow {
  return {
    id: "fight-1",
    settled_at: null,
    fighter1: { name: "Nobody Relevant" },
    fighter2: { name: "Also Nobody" },
    event: { event_date: "2026-09-19", starts_at: STARTS_AT },
    ...overrides,
  };
}

// A genuine one-shared-fighter collision -- the exact shape decideMatch's
// own pinned test uses to assert this stays `low_confidence`, never
// `no_candidates`. Reused here so this dedup test exercises the real
// low_confidence path, not a fabricated one.
function collisionOddsEvent(): OddsEvent {
  return {
    id: "collision-event",
    commence_time: "2026-09-20T04:00:00Z",
    home_team: "Justin Gaethje",
    away_team: "Ilia Topuria",
    bookmakers: [],
  };
}
const collisionFight = fight({
  id: "real-fight",
  fighter1: { name: "Justin Gaethje" },
  fighter2: { name: "Arman Tsarukyan" },
});

describe("matchAndSnapshot -- low_confidence_odds_match dedup", () => {
  it("does not re-queue an odds event whose conflict was already resolved", async () => {
    const { client, inserted } = fakeSupabase(
      [collisionFight],
      [
        {
          id: "conflict-1",
          kind: "low_confidence_odds_match",
          resolved_at: "2026-09-13T00:00:00Z",
          details: { oddsEvent: collisionOddsEvent() },
        },
      ],
    );

    const summary = await matchAndSnapshot(client, [collisionOddsEvent()], NOW);

    expect(summary.lowConfidence).toBe(1); // still counted...
    expect(inserted).toEqual([]); // ...but no new conflict row written
  });

  it("still queues a genuinely new low-confidence odds event", async () => {
    const { client, inserted } = fakeSupabase([collisionFight], []);

    const summary = await matchAndSnapshot(client, [collisionOddsEvent()], NOW);

    expect(summary.lowConfidence).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].table).toBe("data_conflicts");
  });

  // D4 (ROADMAP_V2.md Phase P): the feed re-emitting the same bout under a
  // new event id, with a spelling variant on one fighter's name, must
  // still be recognized as already-queued -- dedup keys on the bout's own
  // identity (buildOddsEventDedupeKey), not the raw, ever-changing
  // oddsEvent.id that let this file twice live.
  it("does not re-queue a re-emitted event for the same bout under a new id with a spelling variant", async () => {
    const reEmitted: OddsEvent = {
      ...collisionOddsEvent(),
      id: "collision-event-v2", // a new id from the feed
      home_team: "Justin Gaethje", // unchanged
    };
    const { client, inserted } = fakeSupabase(
      [collisionFight],
      [
        {
          id: "conflict-1",
          kind: "low_confidence_odds_match",
          resolved_at: null,
          details: { oddsEvent: collisionOddsEvent() }, // originally filed under "collision-event"
        },
      ],
    );

    const summary = await matchAndSnapshot(client, [reEmitted], NOW);

    expect(summary.lowConfidence).toBe(1); // still counted...
    expect(inserted).toEqual([]); // ...but not filed again under the new id
  });
});

describe("matchAndSnapshot -- D3 auto-closes a low_confidence_odds_match once its candidate fight is priced", () => {
  it("resolves an open conflict whose candidate fight already has an odds_snapshots row", async () => {
    const { client, updated } = fakeSupabase(
      [collisionFight],
      [
        {
          id: "stale-conflict",
          kind: "low_confidence_odds_match",
          resolved_at: null,
          details: { oddsEvent: { ...collisionOddsEvent(), id: "unrelated-event" }, candidateFightId: "real-fight" },
        },
      ],
      ["real-fight"], // already priced via some other odds event
    );

    const summary = await matchAndSnapshot(client, [], NOW);

    expect(summary.autoClosed).toBe(1);
    expect(updated).toHaveLength(1);
    expect(updated[0].ids).toEqual(["stale-conflict"]);
    expect(updated[0].payload.resolution).toBe("fight_priced_elsewhere");
  });

  it("leaves an already-resolved conflict alone even if its candidate fight is priced", async () => {
    const { client, updated } = fakeSupabase(
      [collisionFight],
      [
        {
          id: "already-resolved",
          kind: "low_confidence_odds_match",
          resolved_at: "2026-09-10T00:00:00Z",
          details: { oddsEvent: { ...collisionOddsEvent(), id: "unrelated-event" }, candidateFightId: "real-fight" },
        },
      ],
      ["real-fight"],
    );

    const summary = await matchAndSnapshot(client, [], NOW);

    expect(summary.autoClosed).toBe(0);
    expect(updated).toEqual([]);
  });

  it("leaves an open conflict alone when its candidate fight is still unpriced", async () => {
    const { client, updated } = fakeSupabase(
      [collisionFight],
      [
        {
          id: "still-open",
          kind: "low_confidence_odds_match",
          resolved_at: null,
          details: { oddsEvent: { ...collisionOddsEvent(), id: "unrelated-event" }, candidateFightId: "real-fight" },
        },
      ],
      [], // nothing priced
    );

    const summary = await matchAndSnapshot(client, [], NOW);

    expect(summary.autoClosed).toBe(0);
    expect(updated).toEqual([]);
  });
});
