import { findFighterMentionInText } from "./matchFighterMention";
import type { ClaimCheck } from "../llm/types";
import type { CandidatePost, OpenFlagForRetraction, RetractionClaim } from "./types";

export interface RetractionFacts {
  flagsById: Map<string, OpenFlagForRetraction>;
  postsByUri: Map<string, CandidatePost>;
}

/**
 * Ground-truth verification for buildRetractionPrompt.ts's output --
 * generalizes parseClusterResponse.ts's hand-rolled fighter/category/
 * sourceUri checks into ../llm's ClaimCheck shape, run via
 * ../llm/verifyClaims.ts. Order matters here for a different reason than
 * narrowing (no check below narrows a claim): each retract-only check
 * dereferences facts.flagsById.get(claim.flagId)! assuming the earlier
 * checks already confirmed it exists -- verifyClaims short-circuits a
 * claim on its first failing check, so a claim that fails flagIsReal
 * never reaches the checks that assume a real flag.
 *
 * A "keep" claim passes every retract-only check trivially (each returns
 * ok:true immediately when action !== "retract") -- keeping a flag needs
 * no evidence, only retracting one does.
 */

const flagIsReal: ClaimCheck<RetractionClaim, RetractionFacts> = (claim, facts) =>
  facts.flagsById.has(claim.flagId) ? { ok: true, claim } : { ok: false, reason: "unknown_flag_id" };

const actionIsValid: ClaimCheck<RetractionClaim, RetractionFacts> = (claim) =>
  claim.action === "keep" || claim.action === "retract"
    ? { ok: true, claim }
    : { ok: false, reason: "invalid_action" };

// A hallucinated uri is discarded here, never trusted as real evidence --
// the same rule parseClusterResponse.ts's sourceUris filter already
// applies to the clustering path.
const retractionCitesRealPost: ClaimCheck<RetractionClaim, RetractionFacts> = (claim, facts) => {
  if (claim.action !== "retract") return { ok: true, claim };
  if (!claim.supersededByUri || !facts.postsByUri.has(claim.supersededByUri)) {
    return { ok: false, reason: "unknown_source_uri" };
  }
  return { ok: true, claim };
};

// The load-bearing check this whole feature exists for: a retraction is
// only real evidence if the post that justifies it is STRICTLY newer than
// every post that already backs the flag -- never taken from the model's
// own "this is newer" framing in its rationale text.
const retractionPostIsNewer: ClaimCheck<RetractionClaim, RetractionFacts> = (claim, facts) => {
  if (claim.action !== "retract") return { ok: true, claim };
  const flag = facts.flagsById.get(claim.flagId)!;
  const post = facts.postsByUri.get(claim.supersededByUri!)!;
  const isNewer = new Date(post.createdAt).getTime() > new Date(flag.mostRecentSourceAt).getTime();
  return isNewer ? { ok: true, claim } : { ok: false, reason: "superseding_post_not_newer" };
};

// The other half of "never trust the model's own attribution" --
// buildRetractionPrompt.ts deliberately never asks the model to name
// which fighter a superseding post is about (there is no such field on
// RetractionClaim), so this determines it independently from the post's
// own text, the same two-candidate-scoped matching the clustering path
// already uses for exactly this reason.
const retractionPostMentionsRightFighter: ClaimCheck<RetractionClaim, RetractionFacts> = (claim, facts) => {
  if (claim.action !== "retract") return { ok: true, claim };
  const flag = facts.flagsById.get(claim.flagId)!;
  const post = facts.postsByUri.get(claim.supersededByUri!)!;
  const mentioned = findFighterMentionInText(post.text, flag.fighter1, flag.fighter2);
  return mentioned?.id === flag.fighterId ? { ok: true, claim } : { ok: false, reason: "superseding_post_wrong_fighter" };
};

export const retractionChecks: ClaimCheck<RetractionClaim, RetractionFacts>[] = [
  flagIsReal,
  actionIsValid,
  retractionCitesRealPost,
  retractionPostIsNewer,
  retractionPostMentionsRightFighter,
];
