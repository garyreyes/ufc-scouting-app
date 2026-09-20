export interface OpenLowConfidenceConflictForDedupe {
  id: string;
  candidateFightId: string | null;
  detectedAt: string;
}

/**
 * I6 (ROADMAP_V2.md Phase P, Tier 3): two open low_confidence_odds_match
 * rows pointing at the same candidate fight -- the class D4
 * (buildOddsEventDedupeKey.ts) already prevents at write time, checked
 * here as a safety net. Auto-remediated: returns every id EXCEPT the
 * earliest-detected one per group of 2+ sharing a candidateFightId, for
 * the caller to close directly. A null candidateFightId never groups with
 * anything -- there's no shared fight to be a duplicate of.
 */
export function detectDuplicateOddsConflicts(
  conflicts: OpenLowConfidenceConflictForDedupe[],
): string[] {
  const byFightId = new Map<string, OpenLowConfidenceConflictForDedupe[]>();
  for (const c of conflicts) {
    if (c.candidateFightId === null) continue;
    const group = byFightId.get(c.candidateFightId) ?? [];
    group.push(c);
    byFightId.set(c.candidateFightId, group);
  }

  const toClose: string[] = [];
  for (const group of byFightId.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort(
      (a, b) => new Date(a.detectedAt).getTime() - new Date(b.detectedAt).getTime(),
    );
    toClose.push(...sorted.slice(1).map((c) => c.id));
  }
  return toClose;
}
