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
  resolution: string | null;
  details: Record<string, unknown>;
}

function fakeSupabase(seed: { fights: FightRow[]; conflicts: ConflictRow[] }) {
  const fights = [...seed.fights];
  const conflicts = [...seed.conflicts];
  const updates: { id: string; payload: Record<string, unknown> }[] = [];
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
                updates.push({ id, payload });
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
          let notResolvedNull = false;
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
            not(col: string, op: string, val: unknown) {
              if (col === "resolved_at" && op === "is" && val === null) notResolvedNull = true;
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
            then(resolve: (r: { data: ConflictRow[]; error: null }) => void) {
              const rows = conflicts.filter(
                (c) =>
                  c.kind === eqKind &&
                  c.fight_id === eqFightId &&
                  (!notResolvedNull || c.resolved_at !== null),
              );
              resolve({ data: rows, error: null });
            },
          };
          return builder;
        },
        insert(payload: { kind: string; fight_id: string; details: Record<string, unknown> }) {
          return {
            select() {
              return {
                single() {
                  const row: ConflictRow = { id: `conflict-${nextId++}`, resolved_at: null, resolution: null, ...payload };
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

  return { client: client as unknown as SupabaseClient, fights, conflicts, updates };
}

describe("upsertFight -- resolved 'keep current' suppression (M3)", () => {
  it("opens a fresh disputed_opponent conflict on a genuinely new dispute (regression)", async () => {
    const { client, conflicts } = fakeSupabase({
      fights: [
        {
          id: "kept-fight",
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
    expect(conflicts).toHaveLength(1);
  });

  it("does not reopen a dispute the owner already resolved as 'confirmed_existing' for this exact candidate", async () => {
    const { client, conflicts, updates } = fakeSupabase({
      fights: [
        {
          id: "kept-fight",
          external_id: "wiki:Card:a:x",
          event_id: "e1",
          fighter1_id: "a",
          fighter2_id: "x",
          wikipedia_reported_at: null,
          api_sports_reported_at: null,
        },
      ],
      conflicts: [
        {
          id: "old-conflict",
          kind: "disputed_opponent",
          fight_id: "kept-fight",
          resolved_at: "2026-09-13T00:00:00Z",
          resolution: "confirmed_existing",
          details: { candidate_external_id: "wiki:Card:a:c" },
        },
      ],
    });

    const result = await upsertFight(client, {
      external_id: "wiki:Card:a:c",
      event_id: "e1",
      fighter1_id: "a",
      fighter2_id: "c",
      source: "wikipedia",
      method: "Decision",
    });

    // Updated in place, exactly like a normal match -- no new conflict.
    expect(result).toEqual({ status: "upserted", fightId: "kept-fight" });
    expect(conflicts).toHaveLength(1); // the old one, untouched
    expect(updates.some((u) => u.id === "kept-fight")).toBe(true);
  });

  it("still opens a new dispute if a DIFFERENT candidate shows up later, even with a resolved history", async () => {
    const { client, conflicts } = fakeSupabase({
      fights: [
        {
          id: "kept-fight",
          external_id: "wiki:Card:a:x",
          event_id: "e1",
          fighter1_id: "a",
          fighter2_id: "x",
          wikipedia_reported_at: null,
          api_sports_reported_at: null,
        },
      ],
      conflicts: [
        {
          id: "old-conflict",
          kind: "disputed_opponent",
          fight_id: "kept-fight",
          resolved_at: "2026-09-13T00:00:00Z",
          resolution: "confirmed_existing",
          details: { candidate_external_id: "wiki:Card:a:c" }, // a DIFFERENT candidate than below
        },
      ],
    });

    const result = await upsertFight(client, {
      external_id: "wiki:Card:a:d", // new, never-before-seen candidate
      event_id: "e1",
      fighter1_id: "a",
      fighter2_id: "d",
      source: "wikipedia",
    });

    expect(result.status).toBe("conflict");
    expect(conflicts).toHaveLength(2);
  });

  it("still opens a new dispute when the past resolution was 'used_candidate', not 'confirmed_existing'", async () => {
    const { client, conflicts } = fakeSupabase({
      fights: [
        {
          id: "kept-fight",
          external_id: "wiki:Card:a:x",
          event_id: "e1",
          fighter1_id: "a",
          fighter2_id: "x",
          wikipedia_reported_at: null,
          api_sports_reported_at: null,
        },
      ],
      conflicts: [
        {
          id: "old-conflict",
          kind: "disputed_opponent",
          fight_id: "kept-fight",
          resolved_at: "2026-09-13T00:00:00Z",
          resolution: "used_candidate",
          details: { candidate_external_id: "wiki:Card:a:c" },
        },
      ],
    });

    const result = await upsertFight(client, {
      external_id: "wiki:Card:a:c",
      event_id: "e1",
      fighter1_id: "a",
      fighter2_id: "c",
      source: "wikipedia",
    });

    expect(result.status).toBe("conflict");
    expect(conflicts).toHaveLength(2);
  });
});
