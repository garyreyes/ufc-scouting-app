import { describe, expect, it } from "vitest";
import { impliedProbability } from "./impliedProbability";

describe("impliedProbability", () => {
  it("computes a heavy favourite's implied probability (decimal 1.0167 -> 98.4%)", () => {
    // The PRD's own headline example: a -6000 moneyline favourite.
    expect(impliedProbability(1.0167)).toBeCloseTo(0.9836, 4);
  });

  it("computes an underdog's implied probability (decimal 3.5 -> ~28.6%)", () => {
    expect(impliedProbability(3.5)).toBeCloseTo(0.2857, 4);
  });

  it("computes an even-money price as exactly 50%", () => {
    expect(impliedProbability(2.0)).toBe(0.5);
  });
});
