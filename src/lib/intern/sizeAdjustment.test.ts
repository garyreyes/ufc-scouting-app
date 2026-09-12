import { describe, expect, it } from "vitest";
import { sizeAdjustment, MAX_SIZE_ADJUSTMENT, SIZE_ADJUSTMENT_FULL_CM } from "./sizeAdjustment";

// L3: reach (falling back to height) as a small, bounded, signed nudge on
// the intern's market anchor. Correctness-critical (ARCHITECTURE.md item
// #2), so every branch below asserts an exact value, not just a sign.

function fighter(reachCm: number | null, heightCm: number | null) {
  return { reachCm, heightCm };
}

describe("sizeAdjustment", () => {
  it("uses the reach gap when both fighters' reach is known", () => {
    // 10cm reach edge, height would say something different (ignored,
    // since reach is preferred whenever it's available on both sides).
    const delta = sizeAdjustment(fighter(190, 200), fighter(180, 170));
    expect(delta).toBeCloseTo((10 / SIZE_ADJUSTMENT_FULL_CM) * MAX_SIZE_ADJUSTMENT, 6);
    expect(delta).toBeGreaterThan(0);
  });

  it("is negative when fighter2 has the reach advantage", () => {
    const delta = sizeAdjustment(fighter(180, 180), fighter(190, 180));
    expect(delta).toBeCloseTo((-10 / SIZE_ADJUSTMENT_FULL_CM) * MAX_SIZE_ADJUSTMENT, 6);
  });

  it("falls back to the height gap when either fighter's reach is missing", () => {
    const delta = sizeAdjustment(fighter(null, 190), fighter(185, 180));
    expect(delta).toBeCloseTo((10 / SIZE_ADJUSTMENT_FULL_CM) * MAX_SIZE_ADJUSTMENT, 6);
  });

  it("never mixes one fighter's reach with the other's height", () => {
    // fighter1 has reach but no height; fighter2 has height but no reach --
    // neither "both reach" nor "both height" holds, so this must be 0,
    // not a comparison of fighter1's reach against fighter2's height.
    const delta = sizeAdjustment(fighter(190, null), fighter(null, 170));
    expect(delta).toBe(0);
  });

  it("is 0 when neither measurement is known for either fighter", () => {
    expect(sizeAdjustment(fighter(null, null), fighter(null, null))).toBe(0);
  });

  it("is 0 when fighters are the same size", () => {
    expect(sizeAdjustment(fighter(183, 180), fighter(183, 175))).toBe(0);
  });

  it("caps at MAX_SIZE_ADJUSTMENT once the gap reaches SIZE_ADJUSTMENT_FULL_CM", () => {
    expect(sizeAdjustment(fighter(200, 200), fighter(200 - SIZE_ADJUSTMENT_FULL_CM, 180))).toBeCloseTo(
      MAX_SIZE_ADJUSTMENT,
      6,
    );
  });

  it("does not exceed the cap for a gap beyond SIZE_ADJUSTMENT_FULL_CM", () => {
    expect(sizeAdjustment(fighter(220, 220), fighter(180, 180))).toBe(MAX_SIZE_ADJUSTMENT);
    expect(sizeAdjustment(fighter(180, 180), fighter(220, 220))).toBe(-MAX_SIZE_ADJUSTMENT);
  });
});
