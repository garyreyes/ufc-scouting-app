export interface NoiseConflictCandidate {
  id: string;
  details: { confidence?: number };
  resolved_at: string | null;
}

/**
 * P5 (ROADMAP_V2.md Phase P): which OPEN low_confidence_odds_match rows
 * the new MIN_REVIEW_THRESHOLD floor (P2) would never have filed in the
 * first place -- pure noise from before the floor existed (0.231 and
 * below, live 2026-09-20). One-time cleanup only: P2 already stops new
 * noise rows at insert time, so this never needs to run as a recurring
 * job the way P3's stale-conflict closer does.
 *
 * Pure, matching the buildXResolution convention elsewhere in
 * features/conflicts -- the actual DB read/write stays in the one-off
 * cleanup script, not here.
 */
export function selectNoiseLowConfidenceConflictIds(
  conflicts: NoiseConflictCandidate[],
  threshold: number,
): string[] {
  return conflicts
    .filter((c) => c.resolved_at === null)
    .filter((c) => c.details.confidence !== undefined && c.details.confidence < threshold)
    .map((c) => c.id);
}
