import { describe, expect, it } from "vitest";
import { decideInternPick } from "./decideInternPick";
import type { InternFlag, InternPickInput } from "./types";

const fighter1 = { id: "f1", name: "Alexandre Pantoja" };
const fighter2 = { id: "f2", name: "Joshua Van" };

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
});
