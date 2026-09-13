import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertFight } from "./upsertFight";

interface FightRow {
  id: string;
  external_id: string;
  event_id: string;
  fighter1_id: string;
  fighter2_id: string;
  wikipedia_reported_at: string | null;
  api_sports_reported_at: string | null;
}

interface ConflictRow {
  id: string;
  kind: string;
  fight_id: string;
  resolved_at: string | null;
}

/**
 * Covers the three branches upsertFight can take: found by external_id,
 * found by fighter pair, and disputed (shares exactly one fighter). Real
 * assertion here (M2): the "conflict" result must carry the DISPUTED
 * FIGHT's own id, not just the conflict row's id -- processScheduleEvent's
 * reconciliation needs it to know the disputed bout is still "present."
 */
function fakeSupabase(seed: { fights: FightRow[]; conflicts: ConflictRow[] }) {
  const fights = [...seed.fights];
  const conflicts = [...seed.conflicts];
  let nextId = 1;

  const client = {
    from(table: "fights" | "data_conflicts") {
      if (table === "fights") {
        return {
          select() {
            let eqCol: string | null = null;
            let eqVal: unknown = null;
            const builder = {
              eq(col: string, val: unknown) {
                eqCol = col;
                eqVal = val;
                return builder;
              },
              maybeSingle() {
                const row = fights.find((f) => (f as unknown as Record<string, unknown>)[eqCol!] === eqVal);
                return Promise.resolve({ data: row ?? null, error: null });
              },
              then(resolve: (r: { data: FightRow[]; error: null }) => void) {
                resolve({ data: fights.filter((f) => (f as unknown as Record<string, unknown>)[eqCol!] === eqVal), error: null });
              },
            };
            return builder;
          },
          update(payload: Record<string, unknown>) {
            return {
              eq(_c: string, id: string) {
                const row = fights.find((f) => f.id === id);
                if (row) Object.assign(row, payload);
                return Promise.resolve({ error: null });
              },
            };
          },
          insert(payload: Record<string, unknown>) {
            return {
              select() {
                return {
                  single() {
                    const row = { id: `new-${nextId++}`, ...payload } as unknown as FightRow;
                    fights.push(row);
                    return Promise.resolve({ data: { id: row.id }, error: null });
                  },
                };
              },
            };
          },
        };
      }
      // data_conflicts
      return {
        select() {
          let eqKind: string | null = null;
          let eqFightId: string | null = null;
          let isResolvedNull = false;
          const builder = {
            eq(col: string, val: unknown) {
              if (col === "kind") eqKind = val as string;
              if (col === "fight_id") eqFightId = val as string;
              return builder;
            },
            is(col: string, val: unknown) {
              if (col === "resolved_at" && val === null) isResolvedNull = true;
              return builder;
            },
            maybeSingle() {
              const row = conflicts.find(
                (c) =>
                  c.kind === eqKind &&
                  c.fight_id === eqFightId &&
                  (!isResolvedNull || c.resolved_at === null),
              );
              return Promise.resolve({ data: row ?? null, error: null });
            },
          };
          return builder;
        },
        insert(payload: { kind: string; fight_id: string; details: unknown }) {
          return {
            select() {
              return {
                single() {
                  const row: ConflictRow = { id: `conflict-${nextId++}`, resolved_at: null, ...payload };
                  conflicts.push(row);
                  return Promise.resolve({ data: { id: row.id }, error: null });
                },
              };
            },
          };
        },
      };
    },
  };

  return { client: client as unknown as SupabaseClient, fights, conflicts };
}

describe("upsertFight", () => {
  it("returns fightId when found and updated by external_id", async () => {
    const { client } = fakeSupabase({
      fights: [
        {
          id: "f1",
          external_id: "wiki:Card:a:b",
          event_id: "e1",
          fighter1_id: "a",
          fighter2_id: "b",
          wikipedia_reported_at: null,
          api_sports_reported_at: null,
        },
      ],
      conflicts: [],
    });

    const result = await upsertFight(client, {
      external_id: "wiki:Card:a:b",
      event_id: "e1",
      fighter1_id: "a",
      fighter2_id: "b",
      source: "wikipedia",
    });

    expect(result).toEqual({ status: "upserted", fightId: "f1" });
  });

  it("inserts and returns the new fightId when nothing matches", async () => {
    const { client, fights } = fakeSupabase({ fights: [], conflicts: [] });

    const result = await upsertFight(client, {
      external_id: "wiki:Card:a:b",
      event_id: "e1",
      fighter1_id: "a",
      fighter2_id: "b",
      source: "wikipedia",
    });

    expect(result.status).toBe("upserted");
    expect(fights).toHaveLength(1);
  });

  it("returns BOTH conflictId and the disputed fight's own fightId on a new conflict", async () => {
    // "a" fights "x" today; the incoming bout has "a" against "c" -- a
    // genuine opponent dispute, not a new bout.
    const { client } = fakeSupabase({
      fights: [
        {
          id: "disputed-fight",
          external_id: "wiki:Card:a:x",
          event_id: "e1",
          fighter1_id: "a",
          fighter2_id: "x",
          wikipedia_reported_at: null,
          api_sports_reported_at: null,
        },
      ],
      conflicts: [],
    });

    const result = await upsertFight(client, {
      external_id: "wiki:Card:a:c",
      event_id: "e1",
      fighter1_id: "a",
      fighter2_id: "c",
      source: "wikipedia",
    });

    expect(result.status).toBe("conflict");
    if (result.status === "conflict") {
      expect(result.fightId).toBe("disputed-fight");
      expect(result.conflictId).toBeTruthy();
    }
  });

  it("returns the disputed fight's fightId again on a REPEAT conflict (already open)", async () => {
    const { client } = fakeSupabase({
      fights: [
        {
          id: "disputed-fight",
          external_id: "wiki:Card:a:x",
          event_id: "e1",
          fighter1_id: "a",
          fighter2_id: "x",
          wikipedia_reported_at: null,
          api_sports_reported_at: null,
        },
      ],
      conflicts: [
        { id: "existing-conflict", kind: "disputed_opponent", fight_id: "disputed-fight", resolved_at: null },
      ],
    });

    const result = await upsertFight(client, {
      external_id: "wiki:Card:a:c",
      event_id: "e1",
      fighter1_id: "a",
      fighter2_id: "c",
      source: "wikipedia",
    });

    expect(result).toEqual({ status: "conflict", conflictId: "existing-conflict", fightId: "disputed-fight" });
  });
});
