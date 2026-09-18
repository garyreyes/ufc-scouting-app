import type { SherdogProposalClaim } from "./types";

/**
 * N4's reduce step -- a PURE function, deliberately never an LLM call.
 * Rejecting a claim set where two different conflicts propose the same
 * Sherdog id is a deterministic uniqueness check (fighters.sherdog_id is
 * unique, 0036), not a judgment; spending a model call to do it would be
 * strictly worse at a job code already does exactly and cheaply.
 *
 * On a collision, the FIRST claim (by processing order, i.e. the order
 * conflicts were read) is kept and every later one dropped -- a dropped
 * conflict simply gets no proposal this run and stays exactly as open as
 * before, never a wrong or forced answer. A later run re-examines it
 * fresh (this table's rows are replaced on conflict_id, not accumulated),
 * so a dropped proposal is not lost, only deferred.
 */
export function reconcileSherdogProposals(claims: SherdogProposalClaim[]): SherdogProposalClaim[] {
  const claimedIds = new Set<number>();
  const kept: SherdogProposalClaim[] = [];

  for (const claim of claims) {
    if (claim.chosenSherdogId !== null) {
      if (claimedIds.has(claim.chosenSherdogId)) continue;
      claimedIds.add(claim.chosenSherdogId);
    }
    kept.push(claim);
  }

  return kept;
}
