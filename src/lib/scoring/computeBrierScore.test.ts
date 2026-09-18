import { describe, expect, it } from "vitest";
import { computeBrierScore } from "./computeBrierScore";

describe("computeBrierScore", () => {
  it("returns null with no scored entries -- can't average zero things", () => {
    const result = computeBrierScore([]);
    expect(result.score).toBeNull();
    expect(result.n).toBe(0);
  });

  it("ignores unscored (void) entries entirely", () => {
    const result = computeBrierScore([{ estimatedProbability: 0.7, correct: null }]);
    expect(result.score).toBeNull();
    expect(result.n).toBe(0);
  });

  // A pick that called 100% and was right scores a perfect 0 -- the
  // proper-scoring-rule floor.
  it("scores a confident correct call at exactly 0", () => {
    const result = computeBrierScore([{ estimatedProbability: 1, correct: true }]);
    expect(result.score).toBeCloseTo(0, 10);
    expect(result.n).toBe(1);
  });

  // A pick that called near-100% and was WRONG is the worst possible
  // single call -- the proper-scoring-rule ceiling, approaching 1.
  it("scores a confident wrong call near the ceiling of 1", () => {
    const result = computeBrierScore([{ estimatedProbability: 0.99, correct: false }]);
    expect(result.score).toBeCloseTo(0.9801, 10); // (0.99 - 0)^2
  });

  // The reference point every calibration number gets compared against:
  // a coin flip called at exactly 50%, right or wrong, always scores
  // 0.25 -- this is what "no better than guessing" looks like on this
  // scale, and it's the number a real system must beat to be worth
  // anything.
  it("scores a 50/50 call at exactly 0.25 regardless of outcome", () => {
    const correct = computeBrierScore([{ estimatedProbability: 0.5, correct: true }]);
    const wrong = computeBrierScore([{ estimatedProbability: 0.5, correct: false }]);
    expect(correct.score).toBeCloseTo(0.25, 10);
    expect(wrong.score).toBeCloseTo(0.25, 10);
  });

  it("is the mean squared error across multiple scored entries", () => {
    // (1-1)^2=0, (0.6-0)^2=0.36, (0.8-1)^2=0.04 -> mean = 0.4/3
    const result = computeBrierScore([
      { estimatedProbability: 1, correct: true },
      { estimatedProbability: 0.6, correct: false },
      { estimatedProbability: 0.8, correct: true },
    ]);
    expect(result.score).toBeCloseTo(0.4 / 3, 10);
    expect(result.n).toBe(3);
  });

  it("counts n as the scored population only, excluding void entries mixed in", () => {
    const result = computeBrierScore([
      { estimatedProbability: 0.7, correct: true },
      { estimatedProbability: 0.6, correct: null },
      { estimatedProbability: 0.55, correct: false },
    ]);
    expect(result.n).toBe(2);
  });

  // Lower is better -- a system that's consistently more confidently
  // wrong must score strictly worse than one closer to the truth.
  it("scores a worse-calibrated set strictly higher than a better-calibrated one", () => {
    const wellCalibrated = computeBrierScore([
      { estimatedProbability: 0.7, correct: true },
      { estimatedProbability: 0.65, correct: true },
    ]);
    const overconfidentAndWrong = computeBrierScore([
      { estimatedProbability: 0.95, correct: false },
      { estimatedProbability: 0.9, correct: false },
    ]);
    expect(overconfidentAndWrong.score!).toBeGreaterThan(wellCalibrated.score!);
  });
});
