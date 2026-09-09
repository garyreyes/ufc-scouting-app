import { describe, expect, it } from "vitest";
import { planEventMerges, type MergeEventInput, type MergeFightInput } from "./planEventMerges";

function ev(id: string, event_date: string): MergeEventInput {
  return { id, event_date };
}

function ft(
  id: string,
  event_id: string,
  fighter1_id: string,
  fighter2_id: string,
  extra: Partial<MergeFightInput> = {},
): MergeFightInput {
  return {
    id,
    event_id,
    fighter1_id,
    fighter2_id,
    bout_order: null,
    winner_id: null,
    settled_at: null,
    hasBlockingRefs: false,
    ...extra,
  };
}

describe("planEventMerges", () => {
  it("does nothing when same-date events share no bouts", () => {
    const events = [ev("a", "2026-09-12"), ev("b", "2026-09-12")];
    const fights = [ft("1", "a", "x", "y"), ft("2", "b", "p", "q")];
    const result = planEventMerges(events, fights);
    expect(result.plans).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("does nothing for a single event on a date", () => {
    const events = [ev("a", "2026-09-12")];
    const fights = [ft("1", "a", "x", "y")];
    expect(planEventMerges(events, fights)).toEqual({ plans: [], skipped: [] });
  });

  it("ignores duplicate-looking rows on different dates", () => {
    const events = [ev("a", "2026-09-12"), ev("b", "2026-09-19")];
    const fights = [ft("1", "a", "x", "y"), ft("2", "b", "x", "y")];
    expect(planEventMerges(events, fights).plans).toEqual([]);
  });

  // The real 2026-09-12 case: Wikipedia renamed the article, keeper has
  // the full curated card (bout_order set), loser is the stale copy with
  // 7 overlapping bouts + 2 that were dropped from the card. Every loser
  // fight is deleted; the loser event is merged into the keeper.
  it("merges the stale renamed-article duplicate into the curated card", () => {
    const events = [ev("keeper", "2026-09-12"), ev("stale", "2026-09-12")];
    const fights = [
      ft("k0", "keeper", "silva", "delgado", { bout_order: 0 }),
      ft("k1", "keeper", "moreno", "morales", { bout_order: 1 }),
      ft("k2", "keeper", "fiorot", "grasso", { bout_order: 2 }),
      ft("k3", "keeper", "blaydes", "cortesacosta", { bout_order: 3 }),
      ft("k4", "keeper", "ige", "martinez", { bout_order: 4 }),
      ft("s0", "stale", "rodriguez", "silva", { bout_order: null }),
      ft("s1", "stale", "moreno", "morales", { bout_order: null }),
      ft("s2", "stale", "fiorot", "grasso", { bout_order: null }),
      ft("s3", "stale", "belgaroui", "gastelum", { bout_order: null }),
    ];
    const result = planEventMerges(events, fights);
    expect(result.skipped).toEqual([]);
    expect(result.plans).toHaveLength(1);
    const plan = result.plans[0];
    expect(plan.keeperEventId).toBe("keeper");
    expect(plan.loserEventIds).toEqual(["stale"]);
    expect([...plan.deleteFightIds].sort()).toEqual(["s0", "s1", "s2", "s3"]);
  });

  it("picks the keeper by bout_order-set count, not creation order", () => {
    const events = [ev("later", "2026-09-12"), ev("earlier", "2026-09-12")];
    const fights = [
      ft("e1", "earlier", "a", "b"),
      ft("e2", "earlier", "c", "d"),
      ft("l1", "later", "a", "b", { bout_order: 0 }),
      ft("l2", "later", "c", "d", { bout_order: 1 }),
    ];
    const result = planEventMerges(events, fights);
    expect(result.plans[0].keeperEventId).toBe("later");
    expect(result.plans[0].loserEventIds).toEqual(["earlier"]);
  });

  it("breaks a bout_order tie by fight count", () => {
    const events = [ev("small", "2026-09-12"), ev("big", "2026-09-12")];
    const fights = [
      ft("s1", "small", "a", "b"),
      ft("b1", "big", "a", "b"),
      ft("b2", "big", "c", "d"),
    ];
    // big has more fights than small -> big keeps, small (1 fight, subset) merges
    const result = planEventMerges(events, fights);
    expect(result.plans[0].keeperEventId).toBe("big");
    expect(result.plans[0].deleteFightIds).toEqual(["s1"]);
  });

  it("breaks a full tie deterministically by event id", () => {
    const events = [ev("zzz", "2026-09-12"), ev("aaa", "2026-09-12")];
    const fights = [ft("z1", "zzz", "a", "b"), ft("a1", "aaa", "a", "b")];
    const result = planEventMerges(events, fights);
    expect(result.plans[0].keeperEventId).toBe("aaa");
  });

  it("skips (does not guess) when a loser event has more fights than the keeper", () => {
    const events = [ev("curated", "2026-09-12"), ev("fuller", "2026-09-12")];
    const fights = [
      ft("c1", "curated", "a", "b", { bout_order: 0 }),
      ft("f1", "fuller", "a", "b"),
      ft("f2", "fuller", "c", "d"),
      ft("f3", "fuller", "e", "f"),
    ];
    const result = planEventMerges(events, fights);
    expect(result.plans).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].eventIds.sort()).toEqual(["curated", "fuller"]);
    expect(result.skipped[0].reason).toMatch(/more fights/i);
  });

  it("skips when a loser fight is already settled", () => {
    const events = [ev("keeper", "2026-09-12"), ev("loser", "2026-09-12")];
    const fights = [
      ft("k1", "keeper", "a", "b", { bout_order: 0 }),
      ft("l1", "loser", "a", "b", { settled_at: "2026-09-13T02:00:00Z", winner_id: "a" }),
    ];
    const result = planEventMerges(events, fights);
    expect(result.plans).toEqual([]);
    expect(result.skipped[0].reason).toMatch(/result/i);
  });

  it("skips when a loser fight carries a winner even if settled_at is somehow null", () => {
    const events = [ev("keeper", "2026-09-12"), ev("loser", "2026-09-12")];
    const fights = [
      ft("k1", "keeper", "a", "b", { bout_order: 0 }),
      ft("l1", "loser", "a", "b", { settled_at: null, winner_id: "a" }),
    ];
    const result = planEventMerges(events, fights);
    expect(result.plans).toEqual([]);
    expect(result.skipped[0].reason).toMatch(/result/i);
  });

  it("matches a bout the two events list with the fighters in opposite order", () => {
    // The cross-source case the whole feature targets: one source has
    // "Silva vs Delgado", the other "Delgado vs Silva".
    const events = [ev("keeper", "2026-09-12"), ev("loser", "2026-09-12")];
    const fights = [
      ft("k1", "keeper", "silva", "delgado", { bout_order: 0 }),
      ft("l1", "loser", "delgado", "silva"),
    ];
    const result = planEventMerges(events, fights);
    expect(result.skipped).toEqual([]);
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].keeperEventId).toBe("keeper");
    expect(result.plans[0].deleteFightIds).toEqual(["l1"]);
  });

  it("skips when a loser fight is referenced by picks/odds/conflicts", () => {
    const events = [ev("keeper", "2026-09-12"), ev("loser", "2026-09-12")];
    const fights = [
      ft("k1", "keeper", "a", "b", { bout_order: 0 }),
      ft("l1", "loser", "a", "b", { hasBlockingRefs: true }),
    ];
    const result = planEventMerges(events, fights);
    expect(result.plans).toEqual([]);
    expect(result.skipped[0].reason).toMatch(/pick|odds|conflict|referenc/i);
  });

  it("handles three connected duplicate rows for one card", () => {
    const events = [
      ev("keep", "2026-09-12"),
      ev("dup1", "2026-09-12"),
      ev("dup2", "2026-09-12"),
    ];
    const fights = [
      ft("k1", "keep", "a", "b", { bout_order: 0 }),
      ft("k2", "keep", "c", "d", { bout_order: 1 }),
      ft("d1a", "dup1", "a", "b"),
      ft("d2a", "dup2", "c", "d"),
    ];
    const result = planEventMerges(events, fights);
    expect(result.skipped).toEqual([]);
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].keeperEventId).toBe("keep");
    expect(result.plans[0].loserEventIds.sort()).toEqual(["dup1", "dup2"]);
    expect([...result.plans[0].deleteFightIds].sort()).toEqual(["d1a", "d2a"]);
  });

  it("leaves a genuinely unrelated same-date event untouched", () => {
    const events = [
      ev("keep", "2026-09-12"),
      ev("dup", "2026-09-12"),
      ev("other", "2026-09-12"),
    ];
    const fights = [
      ft("k1", "keep", "a", "b", { bout_order: 0 }),
      ft("d1", "dup", "a", "b"),
      ft("o1", "other", "p", "q"),
      ft("o2", "other", "r", "s"),
    ];
    const result = planEventMerges(events, fights);
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].loserEventIds).toEqual(["dup"]);
    expect(result.skipped).toEqual([]);
  });

  it("does not treat an already-merged event as a live duplicate (caller filters merged_into)", () => {
    // planEventMerges only ever sees merged_into IS NULL rows; a second
    // pass over a card already consolidated must produce nothing.
    const events = [ev("keeper", "2026-09-12")];
    const fights = [
      ft("k0", "keeper", "silva", "delgado", { bout_order: 0 }),
      ft("k1", "keeper", "moreno", "morales", { bout_order: 1 }),
    ];
    expect(planEventMerges(events, fights)).toEqual({ plans: [], skipped: [] });
  });
});
