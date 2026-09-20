export interface OpenConflictForStaleCheck {
  id: string;
  detectedAt: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * I5 (ROADMAP_V2.md Phase P, Tier 3): every open conflict older than
 * `maxAgeDays` -- "a queue nobody drains is as bad as no queue." Strictly
 * greater than the threshold, so a conflict exactly `maxAgeDays` old is
 * not yet stale (matches this project's other boundary conventions, e.g.
 * AUTO_MATCH_THRESHOLD's `>=`/`<` split in matchFights.ts).
 */
export function detectStaleConflicts(
  openConflicts: OpenConflictForStaleCheck[],
  now: Date,
  maxAgeDays = 7,
): string[] {
  const maxAgeMs = maxAgeDays * MS_PER_DAY;
  return openConflicts
    .filter((c) => now.getTime() - new Date(c.detectedAt).getTime() > maxAgeMs)
    .map((c) => c.id);
}
