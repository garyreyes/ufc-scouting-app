import { describe, expect, it } from "vitest";
import { DEFAULT_RATING, expectedScore, kFactorForPriorFightCount, updateRatings } from "./eloMath";

describe("kFactorForPriorFightCount", () => {
  it("is highest for a fighter with no prior fights", () => {
    expect(kFactorForPriorFightCount(0)).toBe(64);
  });

  it("steps down as the fighter accumulates a real sample", () => {
    expect(kFactorForPriorFightCount(4)).toBe(64);
    expect(kFactorForPriorFightCount(5)).toBe(48);
    expect(kFactorForPriorFightCount(9)).toBe(48);
    expect(kFactorForPriorFightCount(10)).toBe(32);
    expect(kFactorForPriorFightCount(50)).toBe(32);
  });
});

describe("expectedScore", () => {
  it("is exactly 0.5 for two equal ratings", () => {
    expect(expectedScore(1500, 1500)).toBeCloseTo(0.5, 10);
  });

  it("is symmetric -- both sides' expected scores always sum to 1", () => {
    expect(expectedScore(1600, 1400) + expectedScore(1400, 1600)).toBeCloseTo(1, 10);
  });

  it("favours the higher-rated fighter", () => {
    expect(expectedScore(1700, 1500)).toBeGreaterThan(0.5);
    expect(expectedScore(1500, 1700)).toBeLessThan(0.5);
  });

  // The one number worth pinning exactly: a 400-point gap is the
  // textbook Elo case, expected score ~0.909/0.091.
  it("matches the textbook 400-point-gap case", () => {
    expect(expectedScore(1900, 1500)).toBeCloseTo(0.909, 3);
  });
});

describe("updateRatings", () => {
  it("raises the winner's rating and lowers the loser's, for an even matchup", () => {
    const { ratingA, ratingB } = updateRatings(1500, 1500, 1, 32, 32);
    expect(ratingA).toBeGreaterThan(1500);
    expect(ratingB).toBeLessThan(1500);
  });

  // The one direction it would be easy to get backwards, and the one a
  // mutation would most plausibly produce.
  it("moves the loser's rating DOWN, not up, even against a big underdog win", () => {
    const { ratingB: favouriteAfterLosing } = updateRatings(1900, 1100, 1, 32, 32);
    expect(favouriteAfterLosing).toBeLessThan(1100);
  });

  it("is zero-sum when both fighters share the same K-factor", () => {
    const before = 1500 + 1500;
    const { ratingA, ratingB } = updateRatings(1500, 1500, 1, 32, 32);
    expect(ratingA + ratingB).toBeCloseTo(before, 10);
  });

  it("a draw between equal ratings leaves both unchanged", () => {
    const { ratingA, ratingB } = updateRatings(1500, 1500, 0.5, 32, 32);
    expect(ratingA).toBeCloseTo(1500, 10);
    expect(ratingB).toBeCloseTo(1500, 10);
  });

  it("a heavy favourite gains almost nothing for the expected win", () => {
    const { ratingA } = updateRatings(1900, 1100, 1, 32, 32);
    expect(ratingA - 1900).toBeLessThan(3);
  });

  it("a heavy underdog gains a lot for the upset win", () => {
    const { ratingA: underdogAfterUpset } = updateRatings(1100, 1900, 1, 32, 32);
    expect(underdogAfterUpset - 1100).toBeGreaterThan(29);
  });

  // The actual point of a provisional K-factor: given the identical
  // result, a debuting fighter's rating should move further than a
  // veteran's.
  it("moves a fighter with a higher K-factor further for the identical result", () => {
    const provisional = updateRatings(1500, 1500, 1, 64, 32);
    const veteran = updateRatings(1500, 1500, 1, 32, 32);
    const provisionalMove = provisional.ratingA - 1500;
    const veteranMove = veteran.ratingA - 1500;
    expect(provisionalMove).toBeGreaterThan(veteranMove);
  });
});

describe("DEFAULT_RATING", () => {
  it("is the standard Elo seed value", () => {
    expect(DEFAULT_RATING).toBe(1500);
  });
});
