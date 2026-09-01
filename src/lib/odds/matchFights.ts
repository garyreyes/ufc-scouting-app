import { nameSimilarity } from "./similarity";
import type { FightForMatching, OddsEvent } from "./types";

// Below this, a match is confident enough to write odds_snapshots
// automatically. Deliberately high: a wrong auto-match silently corrupts
// every downstream number (ARCHITECTURE.md item #6), so this errs toward
// the review queue rather than the guess. Adjustable -- not load-bearing
// on anything else -- once real cross-source name variance is observed.
export const AUTO_MATCH_THRESHOLD = 0.85;

// commence_time must fall within this many hours of the local
// event_date to even be considered a candidate. Chosen from the real
// timezone gap already observed live: UFC 331's commence_time
// (2026-09-20T04:00:00Z) is 28 hours after its Wikipedia event_date
// (2026-09-19, Los Angeles local). 36 hours gives headroom without
// reaching into a different card's date. This is what keeps an unscoped
// name search from false-matching a rumoured future fixture -- several
// showed up live with the same fighter against different opponents on
// the same speculative date (see ARCHITECTURE.md Fork 7's B3 note).
const CARD_WINDOW_HOURS = 36;

export function isWithinCardWindow(commenceTimeIso: string, eventDateIso: string): boolean {
  const commence = new Date(commenceTimeIso).getTime();
  const eventDateStart = new Date(`${eventDateIso}T00:00:00Z`).getTime();
  const diffHours = Math.abs(commence - eventDateStart) / (1000 * 60 * 60);
  return diffHours <= CARD_WINDOW_HOURS;
}

export interface FightMatchScore {
  fightId: string;
  confidence: number;
}

/**
 * Scores one Odds API event against every candidate fight already scoped
 * to its date window, returning the best match and its confidence, or
 * null if no fight fell within the window at all. Both fighter-order
 * pairings are tried (home~fighter1/away~fighter2 and the swap), since
 * the API's home/away order isn't guaranteed to align with which fighter
 * is stored as fighter1/fighter2 locally.
 */
export function scoreFightMatch(
  oddsEvent: OddsEvent,
  candidates: FightForMatching[],
): FightMatchScore | null {
  let best: FightMatchScore | null = null;

  for (const fight of candidates) {
    if (!isWithinCardWindow(oddsEvent.commence_time, fight.eventDate)) continue;

    const straight =
      (nameSimilarity(oddsEvent.home_team, fight.fighter1Name) +
        nameSimilarity(oddsEvent.away_team, fight.fighter2Name)) /
      2;
    const swapped =
      (nameSimilarity(oddsEvent.home_team, fight.fighter2Name) +
        nameSimilarity(oddsEvent.away_team, fight.fighter1Name)) /
      2;
    const confidence = Math.max(straight, swapped);

    if (!best || confidence > best.confidence) {
      best = { fightId: fight.id, confidence };
    }
  }

  return best;
}

export type MatchDecision =
  | { kind: "matched"; fightId: string; confidence: number }
  | { kind: "low_confidence"; fightId: string; confidence: number }
  | { kind: "no_candidates" };

/**
 * The actual auto-match / review-queue decision. `no_candidates` is not
 * itself a conflict -- most Odds API events (regional prelims, far-future
 * speculative cards) simply aren't about any fight we're tracking, and
 * that's expected, not ambiguous. Only `low_confidence` -- a real best
 * candidate existed but wasn't confident enough -- is genuinely
 * actionable and belongs in `data_conflicts`.
 */
export function decideMatch(oddsEvent: OddsEvent, candidates: FightForMatching[]): MatchDecision {
  const scored = scoreFightMatch(oddsEvent, candidates);
  if (!scored) return { kind: "no_candidates" };
  if (scored.confidence >= AUTO_MATCH_THRESHOLD) {
    return { kind: "matched", fightId: scored.fightId, confidence: scored.confidence };
  }
  return { kind: "low_confidence", fightId: scored.fightId, confidence: scored.confidence };
}
