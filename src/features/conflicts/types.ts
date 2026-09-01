import type { OddsEvent } from "@/lib/odds/types";

export interface DisputedOpponentDetails {
  candidate_external_id: string;
  candidate_fighter1_id: string;
  candidate_fighter2_id: string;
  winner_id?: string | null;
  method?: string | null;
  round?: number | null;
  weight_class?: string | null;
  bout_order?: number | null;
}

export interface DisputedOpponentConflict {
  id: string;
  kind: "disputed_opponent";
  // The kept row -- these are not two bouts, one bout the sources
  // disagree about (ARCHITECTURE.md Fork 5). Never null for this kind.
  fightId: string;
  detectedAt: string;
  details: DisputedOpponentDetails;
}

export interface LowConfidenceDetails {
  oddsEvent: OddsEvent;
  confidence: number;
  // The algorithm's own best guess -- a starting point for the picker
  // below, not a verdict. See rankFightMatches in lib/odds/matchFights.ts.
  candidateFightId: string;
}

export interface LowConfidenceConflict {
  id: string;
  kind: "low_confidence_odds_match";
  // Deliberately null at the source (matchAndSnapshot.ts) -- an odds-
  // matching ambiguity doesn't identify a specific fight confidently
  // enough to hold it, unlike a disputed opponent.
  fightId: null;
  detectedAt: string;
  details: LowConfidenceDetails;
}

// D1 (lib/settlement/settleFights.ts): both sources reported a winner and
// disagreed, or one reported a winner while the other reported a
// confirmed draw/NC. Raw snapshot of both sources' state at the moment
// of detection -- not re-derived live, since a source could keep
// changing before this gets looked at.
export interface DisputedResultDetails {
  wikipedia_winner_id: string | null;
  wikipedia_method: string | null;
  wikipedia_round: number | null;
  api_sports_winner_id: string | null;
}

export interface DisputedResultConflict {
  id: string;
  kind: "disputed_result";
  // Always the existing fight -- a result dispute is never a "which bout
  // is this" ambiguity the way disputed_opponent is.
  fightId: string;
  detectedAt: string;
  details: DisputedResultDetails;
}

export type Conflict = DisputedOpponentConflict | LowConfidenceConflict | DisputedResultConflict;

// A fight in the same date window as a low-confidence conflict's odds
// event -- the candidate pool the owner picks from, ranked by the
// algorithm's own confidence (see rankFightMatches).
export interface CandidateFight {
  id: string;
  fighter1Name: string;
  fighter2Name: string;
  confidence: number;
}

// Display-ready shapes, joined with fighter/event names -- what
// api.ts's getOpenConflicts actually returns, since the page has no
// other reason to re-derive names from raw ids.
export interface DisputedOpponentDisplay {
  id: string;
  kind: "disputed_opponent";
  detectedAt: string;
  fightId: string;
  eventName: string;
  eventDate: string;
  existingFighter1Name: string;
  existingFighter2Name: string;
  candidateFighter1Name: string;
  candidateFighter2Name: string;
}

export interface LowConfidenceDisplay {
  id: string;
  kind: "low_confidence_odds_match";
  detectedAt: string;
  confidence: number;
  oddsHomeTeam: string;
  oddsAwayTeam: string;
  candidates: CandidateFight[];
}

// Read-only for now, deliberately -- see settleFights.ts's own comment.
// Most result disputes self-resolve the same way disputed_opponent ones
// do (the next twice-daily sync run finds the sources now agree), so a
// manual "pick the winner" action is a well-scoped later add if it turns
// out to genuinely be needed, not a gap in this pass.
export interface DisputedResultDisplay {
  id: string;
  kind: "disputed_result";
  detectedAt: string;
  fightId: string;
  eventName: string;
  eventDate: string;
  fighter1Name: string;
  fighter2Name: string;
  // Null means "reported a draw/NC," not "hasn't reported" -- a display
  // row only ever exists once at least one side has actually reported.
  wikipediaWinnerName: string | null;
  wikipediaMethod: string | null;
  wikipediaRound: number | null;
  apiSportsWinnerName: string | null;
}

export type ConflictDisplay = DisputedOpponentDisplay | LowConfidenceDisplay | DisputedResultDisplay;
