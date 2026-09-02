// G3's calibration check (ROADMAP.md): since estimated_probability is
// stored on every pick, it's directly checkable against reality -- of the
// fights called 70%, did roughly 70% actually happen? Reliability-diagram
// buckets, the standard way to ask that question, shared by both "me" and
// "intern" (features/scoreboard/api.ts calls this once per line) so there
// is exactly one definition of a calibration band in the codebase.
export interface CalibrationBucketDefinition {
  label: string;
  min: number;
  max: number;
}

// Inclusive lower bound, exclusive upper bound, except the top band which
// is closed on both ends (estimated_probability's own schema constraint,
// 0019_picks.sql, is the open interval (0, 1), so 1.0 itself never
// actually occurs -- closing the band anyway costs nothing and avoids a
// silently-dropped edge value if that constraint ever loosens).
// "Under 50%" exists for the same defensive reason: nothing in the schema
// requires a pick's estimate to favour the fighter it names, so a real
// row could land there -- it must be counted, not dropped.
export const CALIBRATION_BUCKETS: CalibrationBucketDefinition[] = [
  { label: "Under 50%", min: 0, max: 0.5 },
  { label: "50–60%", min: 0.5, max: 0.6 },
  { label: "60–70%", min: 0.6, max: 0.7 },
  { label: "70–80%", min: 0.7, max: 0.8 },
  { label: "80–90%", min: 0.8, max: 0.9 },
  { label: "90–100%", min: 0.9, max: 1.0 },
];

export interface CalibrationEntry {
  estimatedProbability: number;
  // null is a void pick (draw/NC/cancelled) -- no correct answer to check
  // the estimate against, same rule aggregateAccuracyLine already applies
  // to the accuracy boards, not a new one invented here.
  correct: boolean | null;
}

export interface CalibrationBucket extends CalibrationBucketDefinition {
  count: number;
  // The average of what was actually claimed within this band -- distinct
  // from the band's own midpoint, since real estimates cluster unevenly
  // inside a 10-point range.
  avgEstimatedPct: number | null;
  // What actually happened, among the same scored entries.
  actualPct: number | null;
}

export function computeCalibrationBuckets(entries: CalibrationEntry[]): CalibrationBucket[] {
  const scored = entries.filter((e): e is { estimatedProbability: number; correct: boolean } => e.correct !== null);

  return CALIBRATION_BUCKETS.map((def) => {
    const inBand = scored.filter((e) =>
      def.max === 1
        ? e.estimatedProbability >= def.min && e.estimatedProbability <= def.max
        : e.estimatedProbability >= def.min && e.estimatedProbability < def.max,
    );

    if (inBand.length === 0) {
      return { ...def, count: 0, avgEstimatedPct: null, actualPct: null };
    }

    const avgEstimatedPct = inBand.reduce((sum, e) => sum + e.estimatedProbability, 0) / inBand.length;
    const actualPct = inBand.filter((e) => e.correct).length / inBand.length;
    return { ...def, count: inBand.length, avgEstimatedPct, actualPct };
  });
}
