import { describe, expect, it } from "vitest";
import { ageAdjustment, MAX_AGE_ADJUSTMENT } from "./ageAdjustment";

// L3-age: a peak-age curve (DECISIONS.md, 2026-09-12). Window 27-32 costs
// nothing; each year under 27 costs half, each year over 32 costs one;
// the gap in cost is scaled so 8 years reaches the ±0.04 cap. Positive
// shades toward fighter1. Correctness-critical, so every case asserts an
// exact value -- and positive, negative and zero are each shown reachable.

describe("ageAdjustment", () => {
  it("shades toward the fighter in their prime against one past it (29 vs 38)", () => {
    expect(ageAdjustment(29, 38)).toBeCloseTo(0.03, 10);
  });

  it("is the exact negation when the fighters are swapped (38 vs 29)", () => {
    expect(ageAdjustment(38, 29)).toBeCloseTo(-0.03, 10);
  });

  it("shades toward the prime fighter against a green one (23 vs 30)", () => {
    expect(ageAdjustment(23, 30)).toBeCloseTo(-0.01, 10);
  });

  it("is exactly 0 when both fighters sit inside the peak window", () => {
    expect(ageAdjustment(30, 31)).toBe(0);
  });

  it("treats both window edges, 27 and 32, as peak", () => {
    expect(ageAdjustment(27, 32)).toBe(0);
  });

  it("charges one year under the window at half weight (26 vs 27)", () => {
    expect(ageAdjustment(26, 27)).toBeCloseTo(-0.0025, 10);
  });

  it("charges one year over the window at full weight (33 vs 32)", () => {
    expect(ageAdjustment(33, 32)).toBeCloseTo(-0.005, 10);
  });

  // Each is 3 years outside the window, but youth is charged half --
  // this is the case a symmetric curve would score as exactly 0.
  it("favours the young fighter over an equally-distant older one (24 vs 35)", () => {
    expect(ageAdjustment(24, 35)).toBeCloseTo(0.0075, 10);
  });

  it("is 0 when both fighters are equally far below the window", () => {
    expect(ageAdjustment(25, 25)).toBe(0);
  });

  it("caps at MAX_AGE_ADJUSTMENT in both directions", () => {
    expect(ageAdjustment(22, 45)).toBe(MAX_AGE_ADJUSTMENT);
    expect(ageAdjustment(45, 22)).toBe(-MAX_AGE_ADJUSTMENT);
  });

  it("is 0 whenever either age is unknown -- no one-sided comparison", () => {
    expect(ageAdjustment(null, 38)).toBe(0);
    expect(ageAdjustment(29, null)).toBe(0);
    expect(ageAdjustment(null, null)).toBe(0);
  });

  it("is the weakest-capped intern signal (below size's 0.06)", () => {
    expect(MAX_AGE_ADJUSTMENT).toBe(0.04);
  });
});
