import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyCardReconciliation } from "./applyCardReconciliation";

interface FightRow {
  id: string;
  external_id: string;
  event_id: string;
  settled_at: string | null;
  settled_from: string | null;
  winner_id: string | null;
  wikipedia_missing_since: string | null;
}

const TITLE = "UFC Fight Night: Silva vs. Delgado";
const EVENT_ID = "event-1";
const NOW = new Date("2026-09-14T12:00:00Z");
// Today-or-future relative to NOW, for every test not specifically about
// the past-event guard below.
const EVENT_DATE = "2026-09-20";

function fakeSupabase(fights: FightRow[]) {
  const updates: { id: string; payload: Record<string, unknown> }[] = [];
  const client = {
    from(table: "fights") {
      if (table !== "fights") throw new Error(`unexpected table ${table}`);
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
            then(resolve: (r: { data: FightRow[]; error: null }) => void) {
              const rows = eqCol
                ? fights.filter((f) => (f as unknown as Record<string, unknown>)[eqCol!] === eqVal)
                : fights;
              resolve({ data: rows, error: null });
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
      };
    },
  };
  return { client: client as unknown as SupabaseClient, fights, updates };
}

function fight(overrides: Partial<FightRow> = {}): FightRow {
  return {
    id: "fight-1",
    external_id: `wiki:${TITLE}:a:b`,
    event_id: EVENT_ID,
    settled_at: null,
    settled_from: null,
    winner_id: "some-winner-placeholder", // overwritten by cancel; irrelevant otherwise
    wikipedia_missing_since: null,
    ...overrides,
  };
}

describe("applyCardReconciliation", () => {
  it("marks a missing fight's wikipedia_missing_since, without settling it", async () => {
    const f = fight({ id: "vera" });
    const { client, updates } = fakeSupabase([f]);

    // parsedBoutCount 1: the page still parsed fine (just not THIS bout) --
    // a real card never legitimately drops to zero parsed bouts while one
    // of them is merely missing; that shape is covered by the "no_bouts"
    // skip test below instead.
    const summary = await applyCardReconciliation(client, EVENT_ID, TITLE, EVENT_DATE, 1, 0, new Set(), NOW);

    expect(summary).toEqual({
      skipped: false,
      skipReason: null,
      markedMissing: 1,
      cancelled: 0,
      clearedMissing: 0,
    });
    expect(updates).toEqual([{ id: "vera", payload: { wikipedia_missing_since: NOW.toISOString() } }]);
    expect(f.settled_at).toBeNull(); // not settled on a first miss
  });

  it("cancels a fight missing past the grace window: settled_at/settled_from/winner_id, never method", async () => {
    const f = fight({
      id: "vera",
      wikipedia_missing_since: new Date("2026-09-14T00:00:00Z").toISOString(),
    });
    const { client, updates } = fakeSupabase([f]);

    const summary = await applyCardReconciliation(client, EVENT_ID, TITLE, EVENT_DATE, 1, 0, new Set(), NOW);

    expect(summary.cancelled).toBe(1);
    expect(updates).toEqual([
      {
        id: "vera",
        payload: { settled_at: NOW.toISOString(), settled_from: "cancelled", winner_id: null },
      },
    ]);
    expect(f.settled_at).toBe(NOW.toISOString());
    expect(f.settled_from).toBe("cancelled");
    expect(f.winner_id).toBeNull();
  });

  it("clears missing_since when a fight reappears", async () => {
    const f = fight({
      id: "reappeared",
      wikipedia_missing_since: new Date("2026-09-14T08:00:00Z").toISOString(),
    });
    const { client, updates } = fakeSupabase([f]);

    const summary = await applyCardReconciliation(
      client,
      EVENT_ID,
      TITLE,
      EVENT_DATE,
      1,
      0,
      new Set(["reappeared"]),
      NOW,
    );

    expect(summary.clearedMissing).toBe(1);
    expect(updates).toEqual([{ id: "reappeared", payload: { wikipedia_missing_since: null } }]);
  });

  it("skips entirely, writing nothing, when the parse dropped a malformed bout", async () => {
    const f = fight({ id: "vera", wikipedia_missing_since: new Date("2026-09-01T00:00:00Z").toISOString() });
    const { client, updates } = fakeSupabase([f]);

    const summary = await applyCardReconciliation(client, EVENT_ID, TITLE, EVENT_DATE, 1, 1, new Set(), NOW);

    expect(summary).toEqual({
      skipped: true,
      skipReason: "malformed_bouts",
      markedMissing: 0,
      cancelled: 0,
      clearedMissing: 0,
    });
    expect(updates).toEqual([]);
    expect(f.settled_at).toBeNull(); // absolutely not cancelled
  });

  it("skips entirely when the fresh parse found zero bouts", async () => {
    const f = fight({ id: "vera", wikipedia_missing_since: new Date("2026-09-01T00:00:00Z").toISOString() });
    const { client, updates } = fakeSupabase([f]);

    const summary = await applyCardReconciliation(client, EVENT_ID, TITLE, EVENT_DATE, 0, 0, new Set(), NOW);

    expect(summary.skipped).toBe(true);
    expect(summary.skipReason).toBe("no_bouts");
    expect(updates).toEqual([]);
  });

  it("skips entirely when the fresh parse found under half the card's existing wiki bouts", async () => {
    // 4 existing unsettled wiki bouts, only 1 parsed this run -- a partial
    // page render, not a real 3-bout cancellation wave.
    const fights = [
      fight({ id: "f1", external_id: `wiki:${TITLE}:a:b` }),
      fight({ id: "f2", external_id: `wiki:${TITLE}:c:d` }),
      fight({ id: "f3", external_id: `wiki:${TITLE}:e:f` }),
      fight({ id: "f4", external_id: `wiki:${TITLE}:g:h` }),
    ];
    const { client, updates } = fakeSupabase(fights);

    const summary = await applyCardReconciliation(client, EVENT_ID, TITLE, EVENT_DATE, 1, 0, new Set(["f1"]), NOW);

    expect(summary.skipped).toBe(true);
    expect(summary.skipReason).toBe("too_few_bouts");
    expect(updates).toEqual([]);
  });

  it("does NOT skip when the parse count is at least half the existing wiki bouts", async () => {
    const fights = [
      fight({ id: "f1", external_id: `wiki:${TITLE}:a:b` }),
      fight({ id: "f2", external_id: `wiki:${TITLE}:c:d` }),
    ];
    const { client } = fakeSupabase(fights);

    // 1 of 2 parsed -- exactly half, should proceed normally.
    const summary = await applyCardReconciliation(client, EVENT_ID, TITLE, EVENT_DATE, 1, 0, new Set(["f1"]), NOW);

    expect(summary.skipped).toBe(false);
    expect(summary.markedMissing).toBe(1); // f2 marked missing, not cancelled or skipped
  });

  it("skips entirely for an already-happened event, even a bout missing well past grace", async () => {
    // Reviewer finding (M2 PR #68): processScheduleEvent is also called
    // from refreshRecentEventResults.ts (re-pulling results for cards up
    // to 30 days finished) and backfillWikipediaHistory.ts (historical
    // cards). The whole grace-window design assumes a still-upcoming
    // card, where "missing from the page" means "pulled from the card."
    // On a PAST card, a bout can go missing from the live wikitext for
    // reasons that have nothing to do with cancellation -- editors
    // folding results into prose, trimming prelims -- and that bout may
    // still be genuinely unsettled for an unrelated reason (an open
    // disputed_opponent conflict, permanently disagreeing sources).
    // Reconciliation must never run at all for a past event date.
    const f = fight({
      id: "vera",
      wikipedia_missing_since: new Date("2026-08-01T00:00:00Z").toISOString(),
    });
    const { client, updates } = fakeSupabase([f]);

    const summary = await applyCardReconciliation(client, EVENT_ID, TITLE, "2026-09-10", 1, 0, new Set(), NOW);

    expect(summary).toEqual({
      skipped: true,
      skipReason: "event_in_past",
      markedMissing: 0,
      cancelled: 0,
      clearedMissing: 0,
    });
    expect(updates).toEqual([]);
    expect(f.settled_at).toBeNull();
  });

  it("does not skip for an event happening today", async () => {
    // The boundary: "today" (same UTC date as `now`) is NOT in the past --
    // a same-day pulled bout is still a real cancellation candidate.
    const f = fight({ id: "vera" });
    const { client } = fakeSupabase([f]);

    const summary = await applyCardReconciliation(
      client,
      EVENT_ID,
      TITLE,
      "2026-09-14", // same UTC date as NOW (2026-09-14T12:00:00Z)
      1,
      0,
      new Set(),
      NOW,
    );

    expect(summary.skipped).toBe(false);
    expect(summary.markedMissing).toBe(1);
  });

  it("never touches a fight already settled by any other means", async () => {
    const f = fight({
      id: "already-settled",
      settled_at: "2026-09-13T00:00:00Z",
      settled_from: "wikipedia_only_24h",
    });
    const { client, updates } = fakeSupabase([f]);

    const summary = await applyCardReconciliation(client, EVENT_ID, TITLE, EVENT_DATE, 1, 0, new Set(), NOW);

    expect(summary).toEqual({
      skipped: false,
      skipReason: null,
      markedMissing: 0,
      cancelled: 0,
      clearedMissing: 0,
    });
    expect(updates).toEqual([]);
  });
});
