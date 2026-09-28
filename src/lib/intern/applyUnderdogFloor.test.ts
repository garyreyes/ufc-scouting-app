import { describe, expect, it } from "vitest";
import { applyUnderdogFloor } from "./applyUnderdogFloor";
import type { FloorInput } from "./applyUnderdogFloor";

// f1 always priced as the favourite (lower decimal price) unless a case
// overrides odds explicitly.
function fight(overrides: Partial<FloorInput> & { fightId: string; segment: "main" | "prelims" }): FloorInput {
  return {
    fighter1Id: `${overrides.fightId}-fav`,
    fighter2Id: `${overrides.fightId}-dog`,
    odds: { fighter1Price: 1.5, fighter2Price: 2.5 },
    pick: { predictedFighterId: `${overrides.fightId}-fav`, estimatedProbability: 0.65, confidence: 4 },
    bet: { betFighterId: null, stakeUnits: null },
    ...overrides,
  };
}

describe("applyUnderdogFloor", () => {
  it("leaves a segment alone when it already has an underdog pick", () => {
    const fights = [
      fight({ fightId: "f0", segment: "main" }),
      fight({
        fightId: "f1",
        segment: "main",
        pick: { predictedFighterId: "f1-dog", estimatedProbability: 0.4, confidence: 1 },
      }),
    ];
    const result = applyUnderdogFloor(fights);
    expect(result.every((f) => !f.pick.overridden)).toBe(true);
  });

  // Owner-decided 2026-09-28: flip the underdog the Intern rates furthest
  // ABOVE the market (probability points vs de-vigged odds), not the
  // biggest price -- the biggest price is usually the dog it rates worst,
  // which cost pick accuracy for nothing.
  it("flips exactly one pick in an all-favourite main card, choosing the underdog with the most edge", () => {
    const fights = [
      // Market dog 0.375; Intern dog 0.40 -> +2.5 pts. The one to flip.
      fight({ fightId: "f0", segment: "main", odds: { fighter1Price: 1.5, fighter2Price: 2.5 }, pick: { predictedFighterId: "f0-fav", estimatedProbability: 0.6, confidence: 3 } }),
      // Biggest price, but market dog 0.2105 vs Intern 0.15 -> -6.1 pts.
      fight({ fightId: "f1", segment: "main", odds: { fighter1Price: 1.2, fighter2Price: 4.5 }, pick: { predictedFighterId: "f1-fav", estimatedProbability: 0.85, confidence: 5 } }),
      // Market dog 0.4737 vs Intern 0.45 -> -2.4 pts.
      fight({ fightId: "f2", segment: "main", odds: { fighter1Price: 1.8, fighter2Price: 2.0 }, pick: { predictedFighterId: "f2-fav", estimatedProbability: 0.55, confidence: 2 } }),
    ];
    const result = applyUnderdogFloor(fights);
    const flipped = result.filter((f) => f.pick.overridden);
    expect(flipped).toHaveLength(1);
    expect(flipped[0].fightId).toBe("f0");
    expect(flipped[0].pick.predictedFighterId).toBe("f0-dog");
    expect(flipped[0].pick.estimatedProbability).toBeCloseTo(0.4, 10);
  });

  it("records the underdog's own model probability on a forced pick, which may be below 0.5", () => {
    const fights = [
      fight({
        fightId: "f0",
        segment: "main",
        odds: { fighter1Price: 1.2, fighter2Price: 4.5 },
        pick: { predictedFighterId: "f0-fav", estimatedProbability: 0.8, confidence: 4 },
      }),
    ];
    const result = applyUnderdogFloor(fights);
    expect(result[0].pick.predictedFighterId).toBe("f0-dog");
    expect(result[0].pick.estimatedProbability).toBeCloseTo(0.2, 10);
    expect(result[0].pick.confidence).toBe(1);
  });

  it("does not touch picks in a segment with no priced fights", () => {
    const fights = [fight({ fightId: "f0", segment: "prelims", odds: null })];
    const result = applyUnderdogFloor(fights);
    expect(result[0].pick.overridden).toBe(false);
  });

  it("applies the pick floor to main card and prelims independently", () => {
    const fights = [
      fight({ fightId: "m0", segment: "main", odds: { fighter1Price: 1.3, fighter2Price: 3.5 } }),
      fight({ fightId: "m1", segment: "main", odds: { fighter1Price: 1.4, fighter2Price: 3.0 } }),
      fight({ fightId: "p0", segment: "prelims", odds: { fighter1Price: 1.2, fighter2Price: 5.0 } }),
      fight({ fightId: "p1", segment: "prelims", odds: { fighter1Price: 1.6, fighter2Price: 2.2 } }),
    ];
    const result = applyUnderdogFloor(fights);
    const flippedIds = result.filter((f) => f.pick.overridden).map((f) => f.fightId);
    expect(flippedIds).toEqual(["m0", "p0"]);
  });

  it("breaks a tie in underdog edge deterministically by fightId", () => {
    const fights = [
      fight({ fightId: "f-b", segment: "main", odds: { fighter1Price: 1.5, fighter2Price: 3.0 } }),
      fight({ fightId: "f-a", segment: "main", odds: { fighter1Price: 1.5, fighter2Price: 3.0 } }),
    ];
    const result = applyUnderdogFloor(fights);
    const flipped = result.filter((f) => f.pick.overridden);
    expect(flipped).toHaveLength(1);
    expect(flipped[0].fightId).toBe("f-a");
  });

  // Phase S2: the bet floor moved a stake sized for the favourite onto the
  // underdog with no edge check at all. Removed -- underdog value now
  // lives in the value-bet slips, and a bet only exists if its own gate fired.
  it("never redirects a bet, even when a segment's only bet is on the favourite", () => {
    const fights = [
      fight({
        fightId: "f0",
        segment: "main",
        odds: { fighter1Price: 1.5, fighter2Price: 2.5 },
        bet: { betFighterId: "f0-fav", stakeUnits: 1.5 },
      }),
      fight({
        fightId: "f1",
        segment: "main",
        odds: { fighter1Price: 1.2, fighter2Price: 4.5 },
        bet: { betFighterId: "f1-fav", stakeUnits: 2 },
      }),
    ];
    const result = applyUnderdogFloor(fights);
    expect(result.map((f) => f.bet)).toEqual([
      { betFighterId: "f0-fav", stakeUnits: 1.5 },
      { betFighterId: "f1-fav", stakeUnits: 2 },
    ]);
  });

  it("is a no-op on an empty card", () => {
    expect(applyUnderdogFloor([])).toEqual([]);
  });
});
