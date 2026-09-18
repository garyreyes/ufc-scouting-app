import type { CalibrationEntry } from "./computeCalibrationBuckets";

// N6: the Brier score is a proper scoring rule -- unlike accuracy, it
// rewards genuine calibration, not just being on the right side of 50%.
// A pick that calls a fight 51% and wins scores almost identically to a
// coin flip (~0.24), while a pick that calls it 95% and wins scores close
// to the floor (~0.0025) -- accuracy alone can't tell those two calls
// apart, and telling them apart is the entire point of comparing a
// deterministic rule against an LLM-assisted one (N8).
//
// Same entry shape and same "correct === null means void, exclude it"
// filter computeCalibrationBuckets already uses -- one definition of
// "which picks count," not two.
export interface BrierScoreResult {
  // null only when there is nothing scored to average -- never NaN.
  score: number | null;
  n: number;
}

export function computeBrierScore(entries: CalibrationEntry[]): BrierScoreResult {
  const scored = entries.filter(
    (e): e is { estimatedProbability: number; correct: boolean } => e.correct !== null,
  );

  if (scored.length === 0) return { score: null, n: 0 };

  const sumSquaredError = scored.reduce((sum, e) => {
    const actual = e.correct ? 1 : 0;
    const error = e.estimatedProbability - actual;
    return sum + error * error;
  }, 0);

  return { score: sumSquaredError / scored.length, n: scored.length };
}
