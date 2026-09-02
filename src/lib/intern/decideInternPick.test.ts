import { describe, expect, it } from "vitest";
import { decideInternPick } from "./decideInternPick";
import type { InternFlag, InternPickInput } from "./types";

// Equal ratings and a deep sample for both by default -- existing tests
// below are about market-anchor and rumour-flag behaviour in isolation,
// so the default fixture is chosen to keep Elo's own adjustment at
// exactly zero (equal ratings) and confidence unaffected by the new
// thin-sample cap (both well past the 6-fight threshold).
const fighter1 = { id: "f1", name: "Alexandre Pantoja", eloRating: 1500, ratedFightCount: 10 };
const fighter2 = { id: "f2", name: "Joshua Van", eloRating: 1500, ratedFightCount: 10 };

function input(overrides: Partial<InternPickInput> = {}): InternPickInput {
  return {
    fighter1,
    fighter2,
    odds: { fighter1Price: 1.5, fighter2Price: 2.5 },
    flags: [],
    ...overrides,
  };
}

function flag(fighterId: string, corroborationCount = 1): InternFlag {
  return { fighterId, category: "weight_cut", corroborationCount };
}

describe("decideInternPick", () => {
  // The market anchor must be de-vigged. Raw 1/1.5 = 66.7% and 1/2.5 =
  // 40% sum to 106.7% -- that 6.7 points is the bookmaker's margin, not
  // anyone's opinion. Using raw implied probability would hand the intern
  // phantom edge on essentially every fight.
  it("de-vigs the market anchor so the two sides sum to exactly 1", () => {
    const decision = decideInternPick(input());
    // 0.6667 / (0.6667 + 0.4) = 0.625
    expect(decision.predictedFighterId).toBe("f1");
    expect(decision.estimatedProbability).toBeCloseTo(0.625, 4);
  });

  it("never lets the raw overround leak into the estimate", () => {
    const decision = decideInternPick(input());
    const rawImplied = 1 / 1.5; // 0.6667 -- what an un-de-vigged version would produce
    expect(decision.estimatedProbability).toBeLessThan(rawImplied);
  });

  it("anchors at an even 50% when the fight has no price yet", () => {
    const decision = decideInternPick(input({ odds: null }));
    expect(decision.estimatedProbability).toBeCloseTo(0.5, 10);
    expect(decision.marketAnchored).toBe(false);
    expect(decision.reasoning).toContain("No market price yet");
  });

  it("marks a priced pick as market-anchored", () => {
    expect(decideInternPick(input()).marketAnchored).toBe(true);
  });

  // The direction that is easiest to get backwards, and the one that
  // would quietly invert the intern's entire scouting opinion.
  it("shades AWAY from a fighter carrying a flag", () => {
    const clean = decideInternPick(input());
    const flagged = decideInternPick(input({ flags: [flag("f1", 2)] }));
    expect(flagged.estimatedProbability).toBeLessThan(clean.estimatedProbability);
  });

  it("shades TOWARD a fighter whose opponent carries a flag", () => {
    const clean = decideInternPick(input());
    const opponentFlagged = decideInternPick(input({ flags: [flag("f2", 2)] }));
    expect(opponentFlagged.estimatedProbability).toBeGreaterThan(clean.estimatedProbability);
  });

  it("cancels out when both fighters carry equal flags", () => {
    const clean = decideInternPick(input());
    const both = decideInternPick(input({ flags: [flag("f1", 2), flag("f2", 2)] }));
    expect(both.estimatedProbability).toBeCloseTo(clean.estimatedProbability, 10);
  });

  // This is the intern actually earning its keep: fading a favourite it
  // has a real reason to doubt (docs/PRD.md UC-3's own example).
  it("can flip the pick to the underdog when the favourite is heavily flagged", () => {
    const decision = decideInternPick(
      input({
        odds: { fighter1Price: 1.9, fighter2Price: 1.95 },
        flags: [flag("f1", 3), flag("f1", 3)],
      }),
    );
    expect(decision.predictedFighterId).toBe("f2");
  });

  it("always reports the probability of the fighter it actually picked", () => {
    const decision = decideInternPick(input({ odds: { fighter1Price: 4.0, fighter2Price: 1.25 } }));
    expect(decision.predictedFighterId).toBe("f2");
    expect(decision.estimatedProbability).toBeGreaterThan(0.5);
  });

  it("keeps the estimate strictly inside (0, 1), as picks' own constraint requires", () => {
    const extreme = decideInternPick(
      input({ odds: { fighter1Price: 1.01, fighter2Price: 25 }, flags: [flag("f2", 99)] }),
    );
    expect(extreme.estimatedProbability).toBeGreaterThan(0);
    expect(extreme.estimatedProbability).toBeLessThan(1);
  });

  it("produces a confidence of 1-5 that rises with the probability", () => {
    const coinFlip = decideInternPick(input({ odds: { fighter1Price: 2.0, fighter2Price: 2.0 } }));
    const lopsided = decideInternPick(input({ odds: { fighter1Price: 1.05, fighter2Price: 12 } }));
    expect(coinFlip.confidence).toBe(1);
    expect(lopsided.confidence).toBe(5);
    expect(lopsided.confidence).toBeGreaterThan(coinFlip.confidence);
  });

  it("is deterministic -- the same fight always produces the same call", () => {
    const a = decideInternPick(input({ flags: [flag("f1", 2)] }));
    const b = decideInternPick(input({ flags: [flag("f1", 2)] }));
    expect(a).toEqual(b);
  });

  it("explains itself in the reasoning, without a credibility verdict", () => {
    const decision = decideInternPick(input({ flags: [flag("f1", 2)] }));
    expect(decision.reasoning).toContain("Market anchor");
    expect(decision.reasoning).toContain("Rumour adjustment");
    expect(decision.reasoning).toContain("Final:");
  });

  describe("Elo integration", () => {
    it("shades toward the higher-rated fighter", () => {
      const clean = decideInternPick(input());
      const eloFavoursF1 = decideInternPick(
        input({ fighter1: { ...fighter1, eloRating: 1700 } }),
      );
      expect(eloFavoursF1.estimatedProbability).toBeGreaterThan(clean.estimatedProbability);
    });

    it("shades away from the lower-rated fighter", () => {
      const clean = decideInternPick(input());
      const eloFavoursF2 = decideInternPick(
        input({ fighter1: { ...fighter1, eloRating: 1300 } }),
      );
      expect(eloFavoursF2.estimatedProbability).toBeLessThan(clean.estimatedProbability);
    });

    // The actual point of eloAdjustment.ts's cap: even a massive rating
    // gap must not be able to override what the market and rumour flags
    // already say by itself.
    it("does not let a huge Elo gap alone flip a pick the market strongly favours the other way", () => {
      const decision = decideInternPick(
        input({
          odds: { fighter1Price: 1.05, fighter2Price: 15 }, // market: f1 is a massive favourite
          fighter1: { ...fighter1, eloRating: 1000 }, // Elo: f2 rates 500 points higher
          fighter2: { ...fighter2, eloRating: 1500 },
        }),
      );
      expect(decision.predictedFighterId).toBe("f1");
    });

    it("names both fighters' ratings in the reasoning", () => {
      const decision = decideInternPick(input());
      expect(decision.reasoning).toContain("Elo:");
      expect(decision.reasoning).toContain("1500");
    });

    it("combines with a rumour adjustment rather than replacing it", () => {
      const eloOnly = decideInternPick(input({ fighter1: { ...fighter1, eloRating: 1600 } }));
      const eloAndRumour = decideInternPick(
        input({ fighter1: { ...fighter1, eloRating: 1600 }, flags: [flag("f1", 2)] }),
      );
      // Elo alone shades toward f1; a rumour flag on f1 on top of that
      // should shade back the other way from the elo-only case.
      expect(eloAndRumour.estimatedProbability).toBeLessThan(eloOnly.estimatedProbability);
    });
  });

  describe("confidence and thin fight history", () => {
    it("caps confidence at 2 when either fighter has fewer than 3 rated fights, even at a lopsided probability", () => {
      const decision = decideInternPick(
        input({
          odds: { fighter1Price: 1.05, fighter2Price: 12 },
          fighter1: { ...fighter1, ratedFightCount: 1 },
        }),
      );
      expect(decision.confidence).toBeLessThanOrEqual(2);
    });

    it("caps confidence at 3 when either fighter has 3-5 rated fights", () => {
      const decision = decideInternPick(
        input({
          odds: { fighter1Price: 1.05, fighter2Price: 12 },
          fighter1: { ...fighter1, ratedFightCount: 4 },
        }),
      );
      expect(decision.confidence).toBeLessThanOrEqual(3);
    });

    it("does not cap confidence when both fighters have a real sample", () => {
      const decision = decideInternPick(input({ odds: { fighter1Price: 1.05, fighter2Price: 12 } }));
      expect(decision.confidence).toBe(5);
    });

    it("the cap uses whichever fighter has the THINNER history, not the picked fighter's own", () => {
      // f2 (the underdog on paper, not who gets picked here) has almost
      // no history -- the whole matchup is under-informed, regardless of
      // which side ends up predicted.
      const decision = decideInternPick(
        input({
          odds: { fighter1Price: 1.05, fighter2Price: 12 },
          fighter2: { ...fighter2, ratedFightCount: 0 },
        }),
      );
      expect(decision.confidence).toBeLessThanOrEqual(2);
    });
  });
});
