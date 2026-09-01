import { describe, expect, it } from "vitest";
import { applyProbabilityDelta } from "./applyProbabilityDelta";

// This is the function that actually produces the number written to
// estimated_probability (0019_picks.sql: check (estimated_probability > 0
// and estimated_probability < 1), a strict open interval) -- get the
// clamp wrong and a real band tap on a lopsided favourite/underdog would
// throw at save time, or worse, silently corrupt the calibration check
// (G3) with an out-of-range value the DB happened to still accept.
describe("applyProbabilityDelta", () => {
  it("adds the delta to the market's implied probability in the ordinary case", () => {
    expect(applyProbabilityDelta(0.6, 0.05)).toBeCloseTo(0.65, 10);
    expect(applyProbabilityDelta(0.6, -0.05)).toBeCloseTo(0.55, 10);
  });

  it("clamps at the high end for a heavy favourite plus an upward delta", () => {
    // The PRD's own -6000 example: 98.36% implied + 10% would be 108.36%,
    // impossible -- must clamp below 1, not overflow or throw.
    const result = applyProbabilityDelta(0.9836, 0.1);
    expect(result).toBeLessThan(1);
    expect(result).toBeGreaterThan(0.9836);
  });

  it("clamps at the low end for a heavy underdog plus a downward delta", () => {
    const result = applyProbabilityDelta(0.02, -0.1);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(0.02);
  });

  it("never returns exactly 0 or 1 even at the extremes", () => {
    expect(applyProbabilityDelta(0.001, -0.1)).toBeGreaterThan(0);
    expect(applyProbabilityDelta(0.999, 0.1)).toBeLessThan(1);
  });
});
