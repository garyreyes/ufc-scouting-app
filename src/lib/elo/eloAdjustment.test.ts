import { describe, expect, it } from "vitest";
import { eloAdjustment, MAX_ELO_ADJUSTMENT } from "./eloAdjustment";

describe("eloAdjustment", () => {
  it("is zero for equal ratings", () => {
    expect(eloAdjustment(1500, 1500)).toBeCloseTo(0, 10);
  });

  it("is positive when fighter 1 is rated higher", () => {
    expect(eloAdjustment(1600, 1500)).toBeGreaterThan(0);
  });

  it("is negative when fighter 1 is rated lower", () => {
    expect(eloAdjustment(1400, 1500)).toBeLessThan(0);
  });

  it("is symmetric -- swapping the two ratings flips the sign, same magnitude", () => {
    const a = eloAdjustment(1650, 1450);
    const b = eloAdjustment(1450, 1650);
    expect(b).toBeCloseTo(-a, 10);
  });

  // The actual point of this function: a huge rating gap must not be
  // able to overwhelm the market anchor on its own.
  it("caps a huge rating gap at MAX_ELO_ADJUSTMENT, never the raw Elo-implied swing", () => {
    const huge = eloAdjustment(2200, 1200); // a 1000-point gap, ~99.7% raw
    expect(huge).toBeCloseTo(MAX_ELO_ADJUSTMENT, 10);
    expect(huge).toBeLessThan(0.497); // nowhere near the raw implied shift
  });

  it("caps a huge gap the other direction too", () => {
    expect(eloAdjustment(1200, 2200)).toBeCloseTo(-MAX_ELO_ADJUSTMENT, 10);
  });

  it("a modest, realistic rating gap stays well under the cap", () => {
    const modest = eloAdjustment(1550, 1500);
    expect(Math.abs(modest)).toBeLessThan(MAX_ELO_ADJUSTMENT);
    expect(modest).toBeGreaterThan(0);
  });
});
