import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSameCardNameVariants } from "./resolveSameCardNameVariants";

interface ConflictRow {
  id: string;
  fight_id: string;
  resolved_at: string | null;
  details: { candidate_fighter1_id: string; candidate_fighter2_id: string };
}

interface FightRow {
  id: string;
  fighter1_id: string;
  fighter2_id: string;
}

interface FighterRow {
  id: string;
  name: string;
  external_id: string | null;
  sherdog_id: number | null;
}

function fakeSupabase(seed: { conflicts: ConflictRow[]; fights: FightRow[]; fighters: FighterRow[] }) {
  const conflictUpdates: { id: string; payload: Record<string, unknown> }[] = [];
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

  const client = {
    from(table: "data_conflicts" | "fights" | "fighters") {
      if (table === "data_conflicts") {
        return {
          select() {
            let eqKind: string | null = null;
            let isResolvedNull = false;
            const builder = {
              eq(col: string, val: unknown) {
                if (col === "kind") eqKind = val as string;
                return builder;
              },
              is(col: string, val: unknown) {
                if (col === "resolved_at" && val === null) isResolvedNull = true;
                return builder;
              },
              then(resolve: (r: { data: ConflictRow[]; error: null }) => void) {
                const rows = seed.conflicts.filter(
                  (c) => (!eqKind || eqKind === "disputed_opponent") && (!isResolvedNull || c.resolved_at === null),
                );
                resolve({ data: rows, error: null });
              },
            };
            return builder;
          },
          update(payload: Record<string, unknown>) {
            return {
              eq(_c: string, id: string) {
                conflictUpdates.push({ id, payload });
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }
      if (table === "fights") {
        return {
          select() {
            let eqId: string | null = null;
            const builder = {
              eq(_c: string, val: string) {
                eqId = val;
                return builder;
              },
              maybeSingle() {
                const row = seed.fights.find((f) => f.id === eqId);
                return Promise.resolve({ data: row ?? null, error: null });
              },
            };
            return builder;
          },
        };
      }
      // fighters
      return {
        select() {
          let inIds: string[] = [];
          const builder = {
            in(_c: string, ids: string[]) {
              inIds = ids;
              return builder;
            },
            then(resolve: (r: { data: FighterRow[]; error: null }) => void) {
              resolve({ data: seed.fighters.filter((f) => inIds.includes(f.id)), error: null });
            },
          };
          return builder;
        },
      };
    },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ error: null });
    },
  };

  return { client: client as unknown as SupabaseClient, conflictUpdates, rpcCalls };
}

describe("resolveSameCardNameVariants", () => {
  it("merges a genuine same-card name variant and resolves the conflict as auto_alias", async () => {
    const conflicts: ConflictRow[] = [
      {
        id: "conflict-1",
        fight_id: "fight-1",
        resolved_at: null,
        details: { candidate_fighter1_id: "silva", candidate_fighter2_id: "delgado-new" },
      },
    ];
    const fights: FightRow[] = [{ id: "fight-1", fighter1_id: "silva", fighter2_id: "delgado-old" }];
    const fighters: FighterRow[] = [
      { id: "delgado-old", name: "Jose Delgado", external_id: null, sherdog_id: 307733 },
      { id: "delgado-new", name: "Jose Miguel Delgado", external_id: "2759", sherdog_id: null },
    ];
    const { client, conflictUpdates, rpcCalls } = fakeSupabase({ conflicts, fights, fighters });

    const summary = await resolveSameCardNameVariants(client);

    expect(summary.merged).toBe(1);
    expect(rpcCalls).toEqual([{ fn: "merge_fighters", args: { p_keep_id: "delgado-new", p_drop_id: "delgado-old" } }]);
    expect(conflictUpdates).toHaveLength(1);
    expect(conflictUpdates[0].id).toBe("conflict-1");
    expect(conflictUpdates[0].payload).toMatchObject({ resolution: "auto_alias" });
  });

  it("does not merge two genuinely different fighters", async () => {
    const conflicts: ConflictRow[] = [
      {
        id: "conflict-1",
        fight_id: "fight-1",
        resolved_at: null,
        details: { candidate_fighter1_id: "gaethje", candidate_fighter2_id: "tsarukyan" },
      },
    ];
    const fights: FightRow[] = [{ id: "fight-1", fighter1_id: "gaethje", fighter2_id: "topuria" }];
    const fighters: FighterRow[] = [
      { id: "topuria", name: "Ilia Topuria", external_id: null, sherdog_id: null },
      { id: "tsarukyan", name: "Arman Tsarukyan", external_id: null, sherdog_id: null },
    ];
    const { client, conflictUpdates, rpcCalls } = fakeSupabase({ conflicts, fights, fighters });

    const summary = await resolveSameCardNameVariants(client);

    expect(summary.merged).toBe(0);
    expect(summary.skippedNotVariant).toBe(1);
    expect(rpcCalls).toEqual([]);
    expect(conflictUpdates).toEqual([]);
  });

  it("does not merge a same-card variant when sherdog ids conflict, and counts it separately", async () => {
    const conflicts: ConflictRow[] = [
      {
        id: "conflict-1",
        fight_id: "fight-1",
        resolved_at: null,
        details: { candidate_fighter1_id: "opp", candidate_fighter2_id: "king-new" },
      },
    ];
    const fights: FightRow[] = [{ id: "fight-1", fighter1_id: "opp", fighter2_id: "king-old" }];
    const fighters: FighterRow[] = [
      { id: "king-old", name: "Sean King", external_id: null, sherdog_id: 48323 },
      { id: "king-new", name: "Sean King III", external_id: null, sherdog_id: 423706 },
    ];
    const { client, rpcCalls } = fakeSupabase({ conflicts, fights, fighters });

    const summary = await resolveSameCardNameVariants(client);

    expect(summary.merged).toBe(0);
    expect(summary.skippedConflictingSherdogIds).toBe(1);
    expect(rpcCalls).toEqual([]);
  });

  it("dry run reports what would merge without calling the RPC or resolving anything", async () => {
    const conflicts: ConflictRow[] = [
      {
        id: "conflict-1",
        fight_id: "fight-1",
        resolved_at: null,
        details: { candidate_fighter1_id: "silva", candidate_fighter2_id: "delgado-new" },
      },
    ];
    const fights: FightRow[] = [{ id: "fight-1", fighter1_id: "silva", fighter2_id: "delgado-old" }];
    const fighters: FighterRow[] = [
      { id: "delgado-old", name: "Jose Delgado", external_id: null, sherdog_id: null },
      { id: "delgado-new", name: "Jose Miguel Delgado", external_id: "2759", sherdog_id: null },
    ];
    const { client, conflictUpdates, rpcCalls } = fakeSupabase({ conflicts, fights, fighters });

    const summary = await resolveSameCardNameVariants(client, { dryRun: true });

    expect(summary.merged).toBe(1);
    expect(summary.dryRun).toBe(true);
    expect(rpcCalls).toEqual([]);
    expect(conflictUpdates).toEqual([]);
  });

  it("does nothing when there are no open disputed_opponent conflicts", async () => {
    const { client } = fakeSupabase({ conflicts: [], fights: [], fighters: [] });
    const summary = await resolveSameCardNameVariants(client);
    expect(summary).toEqual({
      conflictsChecked: 0,
      merged: 0,
      skippedNotVariant: 0,
      skippedConflictingSherdogIds: 0,
      dryRun: false,
    });
  });
});
