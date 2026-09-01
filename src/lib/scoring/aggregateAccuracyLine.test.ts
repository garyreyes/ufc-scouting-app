import { describe, expect, it } from "vitest";
import { aggregateAccuracyLine } from "./aggregateAccuracyLine";

// A void pick has pick_correct = null -- "no correct answer to score,"
// not a wrong answer (ARCHITECTURE.md item #8, C2/D2's own established
// language). It must be excluded from the denominator entirely, not
// counted as an attempt that failed -- scoring a void as wrong would be
// a bug, not a harsh call.
describe("aggregateAccuracyLine", () => {
  it("returns null accuracy and zero total for no data", () => {
    expect(aggregateAccuracyLine([])).toEqual({ correct: 0, total: 0, accuracyPct: null });
  });

  it("returns null accuracy when every value is a void (all null)", () => {
    expect(aggregateAccuracyLine([null, null])).toEqual({ correct: 0, total: 0, accuracyPct: null });
  });

  it("excludes nulls from the denominator, not just the numerator", () => {
    const result = aggregateAccuracyLine([true, false, null, true]);
    expect(result.total).toBe(3);
    expect(result.correct).toBe(2);
    expect(result.accuracyPct).toBeCloseTo(2 / 3, 5);
  });

  it("100% when every non-void pick was correct", () => {
    const result = aggregateAccuracyLine([true, true, null]);
    expect(result.accuracyPct).toBe(1);
    expect(result.total).toBe(2);
  });
});
