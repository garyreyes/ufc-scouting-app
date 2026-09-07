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

export type LowConfidenceReason = "below_threshold" | "ambiguous";

export type SherdogIdentityDecision =
  | { kind: "matched"; sherdogId: number; confidence: number }
  | { kind: "low_confidence"; sherdogId: number; confidence: number; reason: LowConfidenceReason }
  | { kind: "no_candidates" };

/**
 * The auto-match / review-queue decision for one stored fighter name
 * against its Sherdog search results. Mirrors decideFighterMatch exactly:
 *
 *  - `no_candidates` is NOT a conflict -- a genuine debutant or a fighter
 *    Sherdog simply hasn't added yet. The job records the attempt and
 *    moves on.
 *  - `low_confidence` opens a conflict with the whole ranked list. Its
 *    `reason` is `below_threshold` (best guess just isn't good enough) or
 *    `ambiguous` (two or more candidates BOTH clear the threshold --
 *    the exact-homonym case: MMA has multiple "Bruno Silva", "Dong Hyun
 *    Kim" etc., and Sherdog returns them all. Auto-matching here would
 *    key one real fighter's entire career onto a namesake, so a human
 *    picks using the nickname / weight / gym on the review card).
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

  if (best.confidence < SHERDOG_AUTO_MATCH_THRESHOLD) {
    return {
      kind: "low_confidence",
      sherdogId: best.sherdogId,
      confidence: best.confidence,
      reason: "below_threshold",
    };
  }

  const runnerUp = ranked[1];
  if (runnerUp && runnerUp.confidence >= SHERDOG_AUTO_MATCH_THRESHOLD) {
    return {
      kind: "low_confidence",
      sherdogId: best.sherdogId,
      confidence: best.confidence,
      reason: "ambiguous",
    };
  }

  return { kind: "matched", sherdogId: best.sherdogId, confidence: best.confidence };
}

// The tie-break the job applies to an `ambiguous` decision before falling
// back to the review queue: fetch the pages of the candidates that tied
// on name and see how many are a plausible fighter. A real UFC-card
// fighter has a long pro record; a regional namesake with two bouts does
// not, and is not who this app is looking at. Capped -- 17 "Jean Silva"
// candidates are not worth 17 fetches, just queue that.
export const AMBIGUOUS_TIEBREAK_MIN_FIGHTS = 10;
export const AMBIGUOUS_TIEBREAK_MAX_CANDIDATES = 4;

/** The candidates that tied at/above the auto-match threshold, best-first. */
export function tiedTopCandidates(
  storedName: string,
  candidates: SherdogSearchCandidate[],
): RankedSherdogCandidate[] {
  return rankSherdogCandidates(storedName, candidates).filter(
    (c) => c.confidence >= SHERDOG_AUTO_MATCH_THRESHOLD,
  );
}

export interface TiebreakCandidate {
  sherdogId: number;
  guardPassed: boolean;
  proFightCount: number;
}

/**
 * Given each tied candidate's fetched page facts, returns the one
 * sherdog_id to auto-match, or null to send the whole thing to review.
 *
 * Auto-match ONLY when exactly one tied candidate both passes the
 * page-name guard and has a real pro record (>= AMBIGUOUS_TIEBREAK_MIN_
 * FIGHTS). Zero qualifying -> nothing safe to pick. Two or more -> two
 * namesakes with real careers, a human has to choose.
 */
export function pickTiebreakWinner(candidates: TiebreakCandidate[]): number | null {
  const qualifying = candidates.filter(
    (c) => c.guardPassed && c.proFightCount >= AMBIGUOUS_TIEBREAK_MIN_FIGHTS,
  );
  return qualifying.length === 1 ? qualifying[0].sherdogId : null;
}
