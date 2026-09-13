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
  kind: string;
  resolved_at: string | null;
  details: { oddsEvent: { id: string } };
}

function fakeSupabase(fights: FightRow[], conflicts: ConflictRow[]) {
  const inserted: { table: string; payload: Record<string, unknown> }[] = [];
  const client = {
    from(table: "fights" | "odds_snapshots" | "data_conflicts") {
      if (table === "fights") {
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
        };
      }
      // odds_snapshots
      return {
        select() {
          return Promise.resolve({ data: [], error: null }); // nothing priced yet
        },
        insert(payload: Record<string, unknown>) {
          inserted.push({ table: "odds_snapshots", payload });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, inserted };
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
      [{ kind: "low_confidence_odds_match", resolved_at: "2026-09-13T00:00:00Z", details: { oddsEvent: { id: "collision-event" } } }],
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
});
