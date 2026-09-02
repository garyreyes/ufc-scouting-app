import { describe, expect, it } from "vitest";
import { computeCalibrationBuckets, CALIBRATION_BUCKETS } from "./computeCalibrationBuckets";

function bucket(label: string, result: ReturnType<typeof computeCalibrationBuckets>) {
  const found = result.find((b) => b.label === label);
  if (!found) throw new Error(`No bucket labelled "${label}" -- test itself is wrong`);
  return found;
}

describe("computeCalibrationBuckets", () => {
  it("returns every defined bucket, even with no data at all", () => {
    const result = computeCalibrationBuckets([]);
    expect(result).toHaveLength(CALIBRATION_BUCKETS.length);
    for (const b of result) {
      expect(b.count).toBe(0);
      expect(b.avgEstimatedPct).toBeNull();
      expect(b.actualPct).toBeNull();
    }
  });

  it("sorts a scored entry into the correct band", () => {
    const result = computeCalibrationBuckets([{ estimatedProbability: 0.65, correct: true }]);
    const b = bucket("60–70%", result);
    expect(b.count).toBe(1);
    expect(b.avgEstimatedPct).toBeCloseTo(0.65);
    expect(b.actualPct).toBe(1);
  });

  // The exact boundary is the easiest place for an off-by-one to hide --
  // 0.6 belongs to the band it opens (60-70%), not the one it closes
  // (50-60%).
  it("treats a band's lower bound as inclusive to that band, not the one below it", () => {
    const result = computeCalibrationBuckets([{ estimatedProbability: 0.6, correct: true }]);
    expect(bucket("60–70%", result).count).toBe(1);
    expect(bucket("50–60%", result).count).toBe(0);
  });

  // estimated_probability's own schema constraint (0019_picks.sql) is an
  // open (0, 1) interval -- nothing stops a real row from landing under
  // 50% (an underdog pick logged with a low, honest number). Must be
  // counted somewhere, not silently dropped from the whole check.
  it("catches a below-50% estimate in its own band rather than dropping it", () => {
    const result = computeCalibrationBuckets([{ estimatedProbability: 0.3, correct: false }]);
    expect(bucket("Under 50%", result).count).toBe(1);
  });

  it("includes the top edge of the range in the last band", () => {
    const result = computeCalibrationBuckets([{ estimatedProbability: 0.999, correct: true }]);
    expect(bucket("90–100%", result).count).toBe(1);
  });

  // A void pick (draw/NC/cancelled) has no correct answer to check its
  // estimate against -- same "no data to score" rule
  // aggregateAccuracyLine already applies, not a new one invented here.
  it("excludes a void pick (correct: null) from every band entirely", () => {
    const result = computeCalibrationBuckets([{ estimatedProbability: 0.7, correct: null }]);
    for (const b of result) expect(b.count).toBe(0);
  });

  it("averages both the estimate and the actual outcome across multiple entries in one band", () => {
    const result = computeCalibrationBuckets([
      { estimatedProbability: 0.72, correct: true },
      { estimatedProbability: 0.78, correct: false },
    ]);
    const b = bucket("70–80%", result);
    expect(b.count).toBe(2);
    expect(b.avgEstimatedPct).toBeCloseTo(0.75);
    expect(b.actualPct).toBeCloseTo(0.5);
  });

  it("keeps every band independent -- entries in one band never leak into another", () => {
    const result = computeCalibrationBuckets([
      { estimatedProbability: 0.55, correct: true },
      { estimatedProbability: 0.95, correct: false },
    ]);
    expect(bucket("50–60%", result).count).toBe(1);
    expect(bucket("90–100%", result).count).toBe(1);
    expect(bucket("60–70%", result).count).toBe(0);
    expect(bucket("70–80%", result).count).toBe(0);
    expect(bucket("80–90%", result).count).toBe(0);
  });

  it("is deterministic -- identical input always produces identical output", () => {
    const input = [
      { estimatedProbability: 0.65, correct: true },
      { estimatedProbability: 0.4, correct: false },
    ];
    expect(computeCalibrationBuckets(input)).toEqual(computeCalibrationBuckets(input));
  });
});
