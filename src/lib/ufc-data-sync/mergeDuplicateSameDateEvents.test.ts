import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("../elo/recomputeEloRatings", () => ({
  recomputeEloRatings: vi.fn(async () => ({})),
}));

import { mergeDuplicateSameDateEvents } from "./mergeDuplicateSameDateEvents";

interface Row {
  id: string;
  [k: string]: unknown;
}

interface Recorder {
  refQueries: { table: string; ids: string[] }[];
  eventUpdates: { merged_into: string; ids: string[] }[];
  fightDeletes: string[][];
  eloDeletes: string[][];
}

// Minimal fake of the exact chains mergeDuplicateSameDateEvents.ts uses:
//   selectAllPages: .from(t).select(c).order().limit().is()/.in().gt() -> await
//   .from("events").update({..}).in("id", ids)
//   .from("fighter_elo_history").delete().in("fight_id", ids).select("id")
//   .from("fights").delete().in("id", ids)
function fakeSupabase(db: Record<string, Row[]>, rec: Recorder): SupabaseClient {
  const make = (table: string) => {
    let op: "select" | "update" | "delete" = "select";
    const filters: { m: string; col: string; val: unknown }[] = [];

    const builder = {
      select() {
        return builder;
      },
      update() {
        op = "update";
        return builder;
      },
      delete() {
        op = "delete";
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      is(col: string, val: unknown) {
        filters.push({ m: "is", col, val });
        return builder;
      },
      in(col: string, val: unknown) {
        filters.push({ m: "in", col, val });
        return builder;
      },
      gt(col: string, val: unknown) {
        filters.push({ m: "gt", col, val });
        return builder;
      },
      not(col: string, _op: string, val: unknown) {
        filters.push({ m: "not", col, val });
        return builder;
      },
      then(resolve: (r: { data: Row[] | null; error: null }) => void) {
        if (op === "update") {
          const idsFilter = filters.find((f) => f.m === "in" && f.col === "id");
          rec.eventUpdates.push({
            merged_into: "?",
            ids: (idsFilter?.val as string[]) ?? [],
          });
          resolve({ data: null, error: null });
          return;
        }
        if (op === "delete") {
          const inF = filters.find((f) => f.m === "in");
          if (table === "fighter_elo_history") rec.eloDeletes.push((inF?.val as string[]) ?? []);
          if (table === "fights") rec.fightDeletes.push((inF?.val as string[]) ?? []);
          resolve({ data: [], error: null });
          return;
        }
        // select
        let rows = [...(db[table] ?? [])];
        for (const f of filters) {
          if (f.m === "in") rows = rows.filter((r) => (f.val as unknown[]).includes(r[f.col]));
          if (f.m === "is" && f.val === null) rows = rows.filter((r) => r[f.col] == null);
          if (f.m === "gt") rows = rows.filter((r) => String(r.id) > String(f.val));
        }
        rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        if (["picks", "odds_snapshots", "rumour_flags", "data_conflicts"].includes(table)) {
          const inF = filters.find((f) => f.m === "in" && f.col === "fight_id");
          rec.refQueries.push({ table, ids: (inF?.val as string[]) ?? [] });
        }
        resolve({ data: rows, error: null });
      },
    };
    return builder;
  };
  return { from: (t: string) => make(t) } as unknown as SupabaseClient;
}

function baseDb(): Record<string, Row[]> {
  return {
    events: [
      { id: "A", event_date: "2026-08-08", merged_into: null },
      { id: "B", event_date: "2026-08-09", merged_into: null },
      { id: "C", event_date: "2026-09-01", merged_into: null },
    ],
    fights: [
      { id: "a1", event_id: "A", fighter1_id: "X", fighter2_id: "Y", bout_order: 0, winner_id: null, settled_at: null },
      { id: "a2", event_id: "A", fighter1_id: "P", fighter2_id: "Q", bout_order: 1, winner_id: null, settled_at: null },
      { id: "b1", event_id: "B", fighter1_id: "X", fighter2_id: "Y", bout_order: null, winner_id: null, settled_at: null },
      { id: "b2", event_id: "B", fighter1_id: "P", fighter2_id: "Q", bout_order: null, winner_id: null, settled_at: null },
      { id: "c1", event_id: "C", fighter1_id: "M", fighter2_id: "N", bout_order: 0, winner_id: null, settled_at: null },
    ],
    picks: [],
    odds_snapshots: [],
    rumour_flags: [],
    data_conflicts: [],
  };
}

function recorder(): Recorder {
  return { refQueries: [], eventUpdates: [], fightDeletes: [], eloDeletes: [] };
}

describe("mergeDuplicateSameDateEvents (two-pass FK-ref check)", () => {
  it("scopes the FK-ref queries to exactly the fights a merge would delete", async () => {
    const rec = recorder();
    const summary = await mergeDuplicateSameDateEvents(fakeSupabase(baseDb(), rec));

    // keeper A (has bout_order) absorbs B; b1 + b2 are the deletable set.
    expect(summary.duplicateClustersMerged).toBe(1);
    expect(summary.fightsDeleted).toBe(2);
    for (const q of rec.refQueries) {
      expect([...q.ids].sort()).toEqual(["b1", "b2"]); // never a1/a2/c1
    }
    expect(rec.eventUpdates).toEqual([{ merged_into: "?", ids: ["B"] }]);
    expect(rec.fightDeletes).toEqual([["b1", "b2"]]);
  });

  it("pass 2 downgrades the plan to skipped when an at-risk fight is FK-referenced", async () => {
    const rec = recorder();
    const db = baseDb();
    db.picks = [{ id: "p1", fight_id: "b1" }];

    const summary = await mergeDuplicateSameDateEvents(fakeSupabase(db, rec));

    expect(summary.duplicateClustersMerged).toBe(0);
    expect(summary.fightsDeleted).toBe(0);
    expect(rec.fightDeletes).toEqual([]);
    expect(rec.eventUpdates).toEqual([]);
    expect(summary.skipped).toHaveLength(1);
    expect(summary.skipped[0].eventIds.sort()).toEqual(["A", "B"]);
    expect(summary.skipped[0].reason).toMatch(/pick|odds|conflict|rumour/i);
  });

  it("does nothing when there is no duplicate cluster", async () => {
    const rec = recorder();
    const db = baseDb();
    db.events = [db.events[0], db.events[2]]; // A + C, unrelated
    db.fights = db.fights.filter((f) => f.event_id !== "B");

    const summary = await mergeDuplicateSameDateEvents(fakeSupabase(db, rec));
    expect(summary.duplicateClustersMerged).toBe(0);
    expect(rec.refQueries).toEqual([]); // early-out before the FK check
  });
});
