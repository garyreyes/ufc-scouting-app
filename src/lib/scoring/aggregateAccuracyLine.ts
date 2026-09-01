export interface AccuracyLine {
  correct: number;
  total: number;
  // null means no data yet (total === 0), not 0% -- an empty line reads
  // as "nothing scored" on screen, never as "always wrong".
  accuracyPct: number | null;
}

// Shared by all accuracy-board lines (me, intern's full-card and
// head-to-head, chalk). null entries are voids -- excluded from the
// denominator entirely, not scored as incorrect (see the module comment
// in features/scoreboard/api.ts for why that distinction matters).
export function aggregateAccuracyLine(pickCorrectValues: (boolean | null)[]): AccuracyLine {
  const scored = pickCorrectValues.filter((v): v is boolean => v !== null);
  const correct = scored.filter((v) => v).length;
  const total = scored.length;
  return { correct, total, accuracyPct: total === 0 ? null : correct / total };
}
