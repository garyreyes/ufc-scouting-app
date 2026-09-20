import type { FightForMatching } from "../odds/types";

/**
 * I3 (ROADMAP_V2.md Phase P, Tier 3): every fight past its T-12h snapshot
 * window with no price AND nothing already tracking why -- the exact
 * shape of the Pitbull/Choi stuck-fight incident, generalized into a
 * standing check. `eligibleUnpricedFights` is already scoped to "unpriced
 * AND past the window" by the caller (fetchEligibleUnpricedFights,
 * lib/odds/eligibleUnpricedFights.ts); this adds the "AND unconflicted"
 * half so a fight already correctly held by disputed_opponent, or already
 * guessed at by an open low_confidence_odds_match, doesn't also get
 * flagged here as if nothing were watching it.
 */
export function detectUnpricedUnconflictedFights(
  eligibleUnpricedFights: FightForMatching[],
  disputedFightIds: Set<string>,
  openLowConfidenceCandidateFightIds: Set<string>,
): string[] {
  return eligibleUnpricedFights
    .filter((f) => !disputedFightIds.has(f.id) && !openLowConfidenceCandidateFightIds.has(f.id))
    .map((f) => f.id);
}
