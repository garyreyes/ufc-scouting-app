export interface FighterPair {
  fighter1_id: string;
  fighter2_id: string;
}

/**
 * Given a candidate fight already on this event and an incoming fight's
 * fighter pair, determines whether they share EXACTLY one fighter -- the
 * disputed-opponent case from ARCHITECTURE.md Fork 5 (CHANGES.md Phase 7:
 * the two sync sources sometimes report a different opponent for the same
 * fighter). Zero shared fighters means genuinely unrelated fights; two
 * shared fighters means the same fight, already caught by upsertFight.ts's
 * exact unordered-pair match before this ever runs.
 */
export function sharesExactlyOneFighter(candidate: FighterPair, incoming: FighterPair): boolean {
  const candidateIds = new Set([candidate.fighter1_id, candidate.fighter2_id]);
  const incomingIds = new Set([incoming.fighter1_id, incoming.fighter2_id]);

  let shared = 0;
  for (const id of incomingIds) {
    if (candidateIds.has(id)) shared++;
  }
  return shared === 1;
}
