import { describe, expect, it } from "vitest";
import { decideInternPick } from "./decideInternPick";
import type { InternFlag, InternPickInput } from "./types";

// Equal ratings and a deep sample for both by default -- existing tests
// below are about market-anchor and rumour-flag behaviour in isolation,
// so the default fixture is chosen to keep Elo's own adjustment at
// exactly zero (equal ratings) and confidence unaffected by the new
// thin-sample cap (both well past the 6-fight threshold).
const fighter1 = {
  id: "f1",
  name: "Alexandre Pantoja",
  eloRating: 1500,
  ratedFightCount: 10,
  reachCm: null,
  heightCm: null,
  ageYears: null,
};
const fighter2 = {
  id: "f2",
  name: "Joshua Van",
  eloRating: 1500,
  ratedFightCount: 10,
  reachCm: null,
  heightCm: null,
  ageYears: null,
};

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

  describe("size (reach/height) integration", () => {
    it("shades toward the fighter with a reach edge", () => {
      const clean = decideInternPick(input());
      const f1Longer = decideInternPick(input({ fighter1: { ...fighter1, reachCm: 190 }, fighter2: { ...fighter2, reachCm: 175 } }));
      expect(f1Longer.estimatedProbability).toBeGreaterThan(clean.estimatedProbability);
    });

    it("shades away from the fighter with the shorter reach", () => {
      const clean = decideInternPick(input());
      const f1Shorter = decideInternPick(input({ fighter1: { ...fighter1, reachCm: 175 }, fighter2: { ...fighter2, reachCm: 190 } }));
      expect(f1Shorter.estimatedProbability).toBeLessThan(clean.estimatedProbability);
    });

    it("has no effect when neither fighter has a reach or height on file", () => {
      const decision = decideInternPick(input());
      expect(decision.reasoning).toContain("No usable size data");
    });

    it("names the size edge in the reasoning when it applies", () => {
      const decision = decideInternPick(
        input({ fighter1: { ...fighter1, reachCm: 190 }, fighter2: { ...fighter2, reachCm: 175 } }),
      );
      expect(decision.reasoning).toContain("Size edge");
      expect(decision.reasoning).toContain(fighter1.name);
    });

    // sizeAdjustment.ts's own cap (0.06) is small enough that this is
    // never actually in doubt, but the shape must hold: one weak signal
    // never overrides what the market strongly says.
    it("does not let a huge reach gap alone flip a pick the market strongly favours the other way", () => {
      const decision = decideInternPick(
        input({
          odds: { fighter1Price: 1.05, fighter2Price: 15 },
          fighter1: { ...fighter1, reachCm: 170 },
          fighter2: { ...fighter2, reachCm: 210 },
        }),
      );
      expect(decision.predictedFighterId).toBe("f1");
    });
  });

  describe("age integration", () => {
    // No price (anchor 0.5), equal Elo, no size data -- only age moves it,
    // so the result is exactly 0.5 + ageAdjustment(29, 38) = 0.53.
    it("shades toward the fighter closer to peak age by exactly ageAdjustment's amount", () => {
      const decision = decideInternPick(
        input({ odds: null, fighter1: { ...fighter1, ageYears: 29 }, fighter2: { ...fighter2, ageYears: 38 } }),
      );
      expect(decision.predictedFighterId).toBe("f1");
      expect(decision.estimatedProbability).toBeCloseTo(0.53, 10);
    });

    it("shades away from the fighter further from peak", () => {
      const decision = decideInternPick(
        input({ odds: null, fighter1: { ...fighter1, ageYears: 38 }, fighter2: { ...fighter2, ageYears: 29 } }),
      );
      expect(decision.predictedFighterId).toBe("f2");
      expect(decision.estimatedProbability).toBeCloseTo(0.53, 10);
    });

    it("says so when either age is unknown", () => {
      const decision = decideInternPick(input({ fighter1: { ...fighter1, ageYears: 29 } }));
      expect(decision.reasoning).toContain("No usable age data.");
    });

    it("names both ages and the edge in the reasoning", () => {
      const decision = decideInternPick(
        input({ fighter1: { ...fighter1, ageYears: 29 }, fighter2: { ...fighter2, ageYears: 38 } }),
      );
      expect(decision.reasoning).toContain("Age: Alexandre Pantoja 29, Joshua Van 38 — edge Alexandre Pantoja (3.0%).");
    });

    it("reports no edge when both are in their prime", () => {
      const decision = decideInternPick(
        input({ fighter1: { ...fighter1, ageYears: 30 }, fighter2: { ...fighter2, ageYears: 31 } }),
      );
      expect(decision.reasoning).toContain("Age: Alexandre Pantoja 30, Joshua Van 31 (no edge).");
    });
  });

  describe("combined adjustment cap", () => {
    // Rumours (+0.12 toward f1, two max-corroboration flags on f2),
    // Elo (+0.15 toward f1, capped by a 500-point gap), and size (+0.06
    // toward f1, a 30cm reach gap) all agree here -- 0.33 unclamped, but
    // MAX_TOTAL_ADJUSTMENT (0.25) is what the final probability must
    // actually reflect. With no market price (anchor 0.5), the result is
    // an EXACT value: 0.5 + 0.25 = 0.75, not 0.5 + 0.33.
    it("clamps the combined delta even when every signal agrees", () => {
      const decision = decideInternPick(
        input({
          odds: null,
          flags: [flag("f2", 3), flag("f2", 3)],
          fighter1: { ...fighter1, eloRating: 2000, reachCm: 200 },
          fighter2: { ...fighter2, eloRating: 1500, reachCm: 170 },
        }),
      );
      expect(decision.predictedFighterId).toBe("f1");
      expect(decision.estimatedProbability).toBeCloseTo(0.75, 10);
    });

    it("leaves a single signal's own result unchanged when nothing else fires", () => {
      // Elo alone (+0.15) is already below MAX_TOTAL_ADJUSTMENT (0.25),
      // so the combined clamp must be a no-op here -- a regression that
      // clamped every result to 0.25 flat would still pass the test
      // above but fail this one.
      const decision = decideInternPick(input({ odds: null, fighter1: { ...fighter1, eloRating: 2000 } }));
      expect(decision.estimatedProbability).toBeCloseTo(0.65, 10);
    });

    it("still clamps to MAX_TOTAL_ADJUSTMENT with age agreeing on top", () => {
      const decision = decideInternPick(
        input({
          odds: null,
          flags: [flag("f2", 3), flag("f2", 3)],
          fighter1: { ...fighter1, eloRating: 2000, reachCm: 200, ageYears: 29 },
          fighter2: { ...fighter2, eloRating: 1500, reachCm: 170, ageYears: 45 },
        }),
      );
      expect(decision.estimatedProbability).toBeCloseTo(0.75, 10);
    });

    // Elo +0.15 and age +0.03 = 0.18, under the 0.25 ceiling -- age must
    // ADD to another signal, not replace it.
    it("adds age to another signal below the ceiling", () => {
      const decision = decideInternPick(
        input({
          odds: null,
          fighter1: { ...fighter1, eloRating: 2000, ageYears: 29 },
          fighter2: { ...fighter2, ageYears: 38 },
        }),
      );
      expect(decision.estimatedProbability).toBeCloseTo(0.68, 10);
    });
  });
});
