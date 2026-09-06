import { nameSimilarity } from "../text/nameSimilarity";
import type { SherdogSearchCandidate } from "./parseSearch";

// Same value and same reasoning as matchFighterCandidate.ts's
// AUTO_MATCH_THRESHOLD (0.85): a wrong auto-match silently keys one real
// fighter's whole career onto a different person, so err toward the
// review queue. Its own constant, not a shared import -- API-Sports
// matching and Sherdog matching are free to diverge once real data says
// they should, exactly as matchFighterCandidate.ts notes for itself.
export const SHERDOG_AUTO_MATCH_THRESHOLD = 0.85;

export interface RankedSherdogCandidate {
  sherdogId: number;
  name: string;
  confidence: number;
}

/**
 * Every candidate, best-first, scored by name similarity against the
 * name this app already stores. The full list is what a
 * low_confidence_sherdog_match conflict snapshots, so the owner's review
 * screen can override a wrong top pick rather than only confirm/reject
 * it -- same role rankFighterCandidates plays for API-Sports.
 */
export function rankSherdogCandidates(
  storedName: string,
  candidates: SherdogSearchCandidate[],
): RankedSherdogCandidate[] {
  return candidates
    .map((c) => ({
      sherdogId: c.sherdogId,
      name: c.name,
      confidence: nameSimilarity(storedName, c.name),
    }))
    .sort((a, b) => b.confidence - a.confidence);
}

export type SherdogIdentityDecision =
  | { kind: "matched"; sherdogId: number; confidence: number }
  | { kind: "low_confidence"; sherdogId: number; confidence: number }
  | { kind: "no_candidates" };

/**
 * The auto-match / review-queue decision for one stored fighter name
 * against its Sherdog search results. Mirrors decideFighterMatch exactly:
 *
 *  - `no_candidates` is NOT a conflict -- a genuine debutant or a fighter
 *    Sherdog simply hasn't added yet. The job records the attempt and
 *    moves on.
 *  - `low_confidence` opens a conflict with the whole ranked list.
 *  - `matched` is still gated a second time by the page-name guard
 *    (identityGuard.ts) once the fighter page is actually fetched --
 *    this decision is necessary, not sufficient, for a write.
 */
export function decideSherdogIdentity(
  storedName: string,
  candidates: SherdogSearchCandidate[],
): SherdogIdentityDecision {
  const ranked = rankSherdogCandidates(storedName, candidates);
  const best = ranked[0];
  if (!best) return { kind: "no_candidates" };
  if (best.confidence >= SHERDOG_AUTO_MATCH_THRESHOLD) {
    return { kind: "matched", sherdogId: best.sherdogId, confidence: best.confidence };
  }
  return { kind: "low_confidence", sherdogId: best.sherdogId, confidence: best.confidence };
}
