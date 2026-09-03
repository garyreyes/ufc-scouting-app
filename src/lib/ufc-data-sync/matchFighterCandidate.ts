import { nameSimilarity } from "../text/nameSimilarity";
import type { FighterSearchCandidate } from "./searchFighters";

// Same value as lib/odds/matchFights.ts's AUTO_MATCH_THRESHOLD, and the
// same reasoning: a wrong auto-match here silently attaches one real
// fighter's height/reach/stance to a different name -- errs toward the
// review queue over the guess. Its own constant, not a shared import,
// since odds<->fight matching and fighter-record matching are free to
// diverge once real data suggests they should.
export const AUTO_MATCH_THRESHOLD = 0.85;

export interface FighterCandidateScore {
  externalId: string;
  confidence: number;
}

function scoreCandidates(storedName: string, candidates: FighterSearchCandidate[]): FighterCandidateScore[] {
  return candidates.map((c) => ({ externalId: c.externalId, confidence: nameSimilarity(storedName, c.name) }));
}

/**
 * Every candidate, ranked best-first -- the owner's own review screen
 * for a low-confidence match (mirroring rankFightMatches' role in B6),
 * so a wrong top pick can be corrected rather than only ever confirmed
 * or rejected blind.
 */
export function rankFighterCandidates(
  storedName: string,
  candidates: FighterSearchCandidate[],
): FighterCandidateScore[] {
  return scoreCandidates(storedName, candidates).sort((a, b) => b.confidence - a.confidence);
}

export type FighterMatchDecision =
  | { kind: "matched"; externalId: string; confidence: number }
  | { kind: "low_confidence"; externalId: string; confidence: number }
  | { kind: "no_candidates" };

/**
 * The actual auto-match / review-queue decision for one name-only
 * fighter row against its API-Sports search results. `no_candidates` is
 * not itself a conflict -- a real debutant or a very recent signee
 * simply hasn't reached API-Sports yet, the same "expected, not
 * ambiguous" reasoning lib/odds/matchFights.ts already applies to an
 * unmatched odds event.
 */
export function decideFighterMatch(
  storedName: string,
  candidates: FighterSearchCandidate[],
): FighterMatchDecision {
  const ranked = rankFighterCandidates(storedName, candidates);
  const best = ranked[0];
  if (!best) return { kind: "no_candidates" };
  if (best.confidence >= AUTO_MATCH_THRESHOLD) {
    return { kind: "matched", externalId: best.externalId, confidence: best.confidence };
  }
  return { kind: "low_confidence", externalId: best.externalId, confidence: best.confidence };
}
