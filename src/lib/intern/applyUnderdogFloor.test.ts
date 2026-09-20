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

  it("flips exactly one pick in an all-favourite main card, choosing the biggest underdog price", () => {
    const fights = [
      fight({ fightId: "f0", segment: "main", odds: { fighter1Price: 1.5, fighter2Price: 2.5 } }),
      fight({ fightId: "f1", segment: "main", odds: { fighter1Price: 1.2, fighter2Price: 4.5 } }), // biggest dog price
      fight({ fightId: "f2", segment: "main", odds: { fighter1Price: 1.8, fighter2Price: 2.0 } }),
    ];
    const result = applyUnderdogFloor(fights);
    const flipped = result.filter((f) => f.pick.overridden);
    expect(flipped).toHaveLength(1);
    expect(flipped[0].fightId).toBe("f1");
    expect(flipped[0].pick.predictedFighterId).toBe("f1-dog");
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

  it("breaks a tie in underdog price deterministically by fightId", () => {
    const fights = [
      fight({ fightId: "f-b", segment: "main", odds: { fighter1Price: 1.5, fighter2Price: 3.0 } }),
      fight({ fightId: "f-a", segment: "main", odds: { fighter1Price: 1.5, fighter2Price: 3.0 } }),
    ];
    const result = applyUnderdogFloor(fights);
    const flipped = result.filter((f) => f.pick.overridden);
    expect(flipped).toHaveLength(1);
    expect(flipped[0].fightId).toBe("f-a");
  });

  describe("bet floor", () => {
    it("never forces a bet into existence when INTERN placed no bets in the segment", () => {
      const fights = [
        fight({ fightId: "f0", segment: "main" }),
        fight({ fightId: "f1", segment: "main", odds: { fighter1Price: 1.2, fighter2Price: 4.5 } }),
      ];
      const result = applyUnderdogFloor(fights);
      expect(result.every((f) => f.bet.betFighterId === null && !f.bet.overridden)).toBe(true);
    });

    it("leaves bets alone when one already backs the underdog", () => {
      const fights = [
        fight({
          fightId: "f0",
          segment: "main",
          bet: { betFighterId: "f0-fav", stakeUnits: 1.5 },
        }),
        fight({
          fightId: "f1",
          segment: "main",
          odds: { fighter1Price: 1.2, fighter2Price: 4.5 },
          bet: { betFighterId: "f1-dog", stakeUnits: 1 },
        }),
      ];
      const result = applyUnderdogFloor(fights);
      expect(result.every((f) => !f.bet.overridden)).toBe(true);
    });

    it("redirects the existing bet with the biggest underdog price onto the underdog, keeping the same stake", () => {
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
        // No bet on this fight at all -- must never become a flip candidate.
        fight({ fightId: "f2", segment: "main", odds: { fighter1Price: 1.1, fighter2Price: 8.0 } }),
      ];
      const result = applyUnderdogFloor(fights);
      const flippedBet = result.find((f) => f.bet.overridden);
      expect(flippedBet?.fightId).toBe("f1");
      expect(flippedBet?.bet.betFighterId).toBe("f1-dog");
      expect(flippedBet?.bet.stakeUnits).toBe(2);
      expect(result.find((f) => f.fightId === "f2")?.bet.overridden).toBe(false);
    });

    it("is independent of the pick floor -- can flip a different fight's bet than the fight whose pick was flipped", () => {
      const fights = [
        // Biggest dog price overall -- pick floor flips this one.
        fight({
          fightId: "f0",
          segment: "main",
          odds: { fighter1Price: 1.1, fighter2Price: 9.0 },
          bet: { betFighterId: null, stakeUnits: null },
        }),
        // Only fight with a real bet, on the favourite -- bet floor must flip THIS one.
        fight({
          fightId: "f1",
          segment: "main",
          odds: { fighter1Price: 1.5, fighter2Price: 2.5 },
          bet: { betFighterId: "f1-fav", stakeUnits: 1 },
        }),
      ];
      const result = applyUnderdogFloor(fights);
      expect(result.find((f) => f.fightId === "f0")?.pick.overridden).toBe(true);
      expect(result.find((f) => f.fightId === "f0")?.bet.overridden).toBe(false);
      expect(result.find((f) => f.fightId === "f1")?.pick.overridden).toBe(false);
      expect(result.find((f) => f.fightId === "f1")?.bet.overridden).toBe(true);
      expect(result.find((f) => f.fightId === "f1")?.bet.betFighterId).toBe("f1-dog");
    });
  });

  it("is a no-op on an empty card", () => {
    expect(applyUnderdogFloor([])).toEqual([]);
  });
});
