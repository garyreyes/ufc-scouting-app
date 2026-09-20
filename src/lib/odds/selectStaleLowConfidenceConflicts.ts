export interface StaleConflictCandidate {
  id: string;
  details: { candidateFightId?: string | null };
}

/**
 * D3 (ROADMAP_V2.md Phase P): which open low_confidence_odds_match rows
 * are safe to auto-close because the fight they guessed at is already
 * priced -- by a different, more confident odds event, or by a manual
 * resolution. Without this, a row like this accretes forever once its
 * fight gets priced through any path other than resolving the row itself
 * (5 such rows were found live, all `snaps = 1`, 2026-09-20).
 *
 * Pure, matching the buildXResolution convention elsewhere in
 * features/conflicts -- matchAndSnapshot.ts owns the actual reads/writes.
 */
export function selectStaleLowConfidenceConflictIds(
  conflicts: StaleConflictCandidate[],
  pricedFightIds: Set<string>,
): string[] {
  return conflicts
    .filter((c) => c.details.candidateFightId && pricedFightIds.has(c.details.candidateFightId))
    .map((c) => c.id);
}
