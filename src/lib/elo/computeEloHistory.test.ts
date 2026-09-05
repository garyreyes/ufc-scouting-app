import { describe, expect, it } from "vitest";
import { computeEloHistory } from "./computeEloHistory";
import type { FightForElo } from "./computeEloHistory";
import { DEFAULT_RATING } from "./eloMath";

function fight(overrides: Partial<FightForElo>): FightForElo {
  return {
    fightId: "f1",
    fighter1Id: "a",
    fighter2Id: "b",
    winnerId: "a",
    method: "Decision",
    occurredAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("computeEloHistory", () => {
  it("gives two debut fighters the default rating going in, and produces one snapshot each", () => {
    const snapshots = computeEloHistory([fight({})]);
    expect(snapshots).toHaveLength(2);
    const a = snapshots.find((s) => s.fighterId === "a")!;
    const b = snapshots.find((s) => s.fighterId === "b")!;
    expect(a.rating).toBeGreaterThan(DEFAULT_RATING);
    expect(b.rating).toBeLessThan(DEFAULT_RATING);
  });

  // The whole point of this being a sequential algorithm, not a simple
  // reduce over insertion order: a caller that hands fights in the wrong
  // order must still get the historically correct result.
  it("processes fights in chronological order regardless of input order", () => {
    const early = fight({
      fightId: "f-early",
      fighter1Id: "a",
      fighter2Id: "x",
      winnerId: "a",
      occurredAt: "2026-01-01T00:00:00Z",
    });
    const late = fight({
      fightId: "f-late",
      fighter1Id: "a",
      fighter2Id: "y",
      winnerId: "y",
      occurredAt: "2026-06-01T00:00:00Z",
    });

    const inOrder = computeEloHistory([early, late]);
    const outOfOrder = computeEloHistory([late, early]);

    expect(outOfOrder).toEqual(inOrder);
  });

  it("carries a fighter's rating forward across multiple fights", () => {
    const first = fight({ fightId: "f1", fighter1Id: "a", fighter2Id: "b", winnerId: "a" });
    const second = fight({
      fightId: "f2",
      fighter1Id: "a",
      fighter2Id: "c",
      winnerId: "a",
      occurredAt: "2026-02-01T00:00:00Z",
    });
    const snapshots = computeEloHistory([first, second]);

    const aAfterFirst = snapshots.find((s) => s.fighterId === "a" && s.fightId === "f1")!.rating;
    const aAfterSecond = snapshots.find((s) => s.fighterId === "a" && s.fightId === "f2")!.rating;
    // Winning again should raise the rating further, from wherever it
    // already was after the first win, not from the default seed again.
    expect(aAfterSecond).toBeGreaterThan(aAfterFirst);
  });

  it("treats a real draw as a 0.5/0.5 result that still moves ratings and counts as a fight", () => {
    const snapshots = computeEloHistory([fight({ winnerId: null, method: "Majority Draw" })]);
    expect(snapshots).toHaveLength(2);
    // Two equal-rated debut fighters drawing: expected score was already
    // 0.5, so the actual draw changes nothing.
    const a = snapshots.find((s) => s.fighterId === "a")!;
    expect(a.rating).toBeCloseTo(DEFAULT_RATING, 6);
  });

  // The actual correctness-critical distinction this file exists to get
  // right: an NC must never move a rating, unlike a real draw.
  it("excludes a No Contest entirely -- no snapshot rows, ratings untouched", () => {
    const snapshots = computeEloHistory([fight({ winnerId: null, method: "NC (overturned)" })]);
    expect(snapshots).toHaveLength(0);
  });

  it("recognises 'No Contest' spelled out, not just the 'NC' abbreviation", () => {
    const snapshots = computeEloHistory([fight({ winnerId: null, method: "No Contest" })]);
    expect(snapshots).toHaveLength(0);
  });

  it("excludes a void result with no method text at all, rather than guessing draw or NC", () => {
    const snapshots = computeEloHistory([fight({ winnerId: null, method: null })]);
    expect(snapshots).toHaveLength(0);
  });

  it("a subsequent fight after an excluded NC still uses the pre-NC rating and fight count", () => {
    const winFirst = fight({ fightId: "f1", winnerId: "a", occurredAt: "2026-01-01T00:00:00Z" });
    const ncSecond = fight({
      fightId: "f2",
      fighter1Id: "a",
      fighter2Id: "c",
      winnerId: null,
      method: "NC",
      occurredAt: "2026-02-01T00:00:00Z",
    });
    const winThird = fight({
      fightId: "f3",
      fighter1Id: "a",
      fighter2Id: "d",
      winnerId: "a",
      occurredAt: "2026-03-01T00:00:00Z",
    });

    const withNc = computeEloHistory([winFirst, ncSecond, winThird]);
    const withoutNc = computeEloHistory([winFirst, winThird]);

    const aFinalWithNc = withNc.find((s) => s.fighterId === "a" && s.fightId === "f3")!.rating;
    const aFinalWithoutNc = withoutNc.find((s) => s.fighterId === "a" && s.fightId === "f3")!.rating;
    expect(aFinalWithNc).toBeCloseTo(aFinalWithoutNc, 6);
  });

  it("defensively excludes a fight whose winner_id matches neither listed fighter", () => {
    const snapshots = computeEloHistory([fight({ winnerId: "someone-else-entirely" })]);
    expect(snapshots).toHaveLength(0);
  });

  it("defensively excludes a self-fight, where both sides are the same fighter row", () => {
    // upsertFighter's name-fold can collapse two identities onto one row
    // (the I4b class of duplicate) -- nothing in the schema forbids
    // fighter1_id === fighter2_id. Left unguarded, updateRatings would
    // produce two DIFFERENT ratings for that one fighter/fight pair, and
    // both get pushed into snapshots -- fighter_elo_history's own
    // `unique (fighter_id, fight_id)` constraint (0029) means the second
    // insert throws, and by then recomputeEloRatings has already
    // deleted the whole table. One bad row would wipe every rating.
    const snapshots = computeEloHistory([
      fight({ fighter1Id: "a", fighter2Id: "a", winnerId: "a" }),
    ]);
    expect(snapshots).toHaveLength(0);
  });

  it("gives a debuting fighter a bigger rating swing than a fighter with a long history, for the same result", () => {
    // "a" has 12 prior fights (all wins, alternating opponents so k
    // settles); "z" is a total debutant facing "a" for the first time.
    const priorFights: FightForElo[] = Array.from({ length: 12 }, (_, i) =>
      fight({
        fightId: `warmup-${i}`,
        fighter1Id: "a",
        fighter2Id: `opponent-${i}`,
        winnerId: "a",
        occurredAt: `2025-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      }),
    );
    const upset = fight({
      fightId: "f-upset",
      fighter1Id: "a",
      fighter2Id: "z",
      winnerId: "z",
      occurredAt: "2026-06-01T00:00:00Z",
    });

    const snapshots = computeEloHistory([...priorFights, upset]);
    const aRatingBeforeUpset = snapshots.find(
      (s) => s.fighterId === "a" && s.fightId === "warmup-11",
    )!.rating;
    const aRatingAfterUpset = snapshots.find((s) => s.fighterId === "a" && s.fightId === "f-upset")!
      .rating;
    const zRatingAfterUpset = snapshots.find((s) => s.fighterId === "z" && s.fightId === "f-upset")!
      .rating;

    const aDrop = aRatingBeforeUpset - aRatingAfterUpset;
    const zGain = zRatingAfterUpset - DEFAULT_RATING;
    expect(zGain).toBeGreaterThan(aDrop);
  });
});
