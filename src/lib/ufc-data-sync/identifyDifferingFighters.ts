import type { FighterPair } from "./sharesExactlyOneFighter";

/**
 * M3: given two fighter pairs already known to share exactly one fighter
 * (a disputed_opponent conflict's kept-row pairing vs. the incoming
 * candidate's pairing), returns the two DIFFERING ids -- the ones an
 * owner or the auto-resolve sweep is actually being asked "are these the
 * same person?" about. Returns null defensively if the pairs don't
 * actually share exactly one fighter (0 shared: unrelated; 2 shared: the
 * same bout, not a dispute at all) -- disputed_opponent's own detection
 * (sharesExactlyOneFighter.ts) already guarantees this holds in practice,
 * but a caller reading a possibly-stale conflict row should never assume it.
 */
export function identifyDifferingFighters(
  existing: FighterPair,
  candidate: FighterPair,
): { a: string; b: string } | null {
  const existingIds = [existing.fighter1_id, existing.fighter2_id];
  const candidateIds = [candidate.fighter1_id, candidate.fighter2_id];
  const shared = existingIds.filter((id) => candidateIds.includes(id));
  if (shared.length !== 1) return null;

  const sharedId = shared[0];
  const a = existingIds.find((id) => id !== sharedId);
  const b = candidateIds.find((id) => id !== sharedId);
  if (a === undefined || b === undefined) return null;

  return { a, b };
}
