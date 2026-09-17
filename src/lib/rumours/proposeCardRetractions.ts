import type { SupabaseClient } from "@supabase/supabase-js";
import { runMapReduce } from "../llm/runMapReduce";
import { verifyClaims } from "../llm/verifyClaims";
import type { Degradation, MapReduceDeps, MapReduceSpec } from "../llm/runMapReduce";
import { buildRetractionPrompt } from "./buildRetractionPrompt";
import { parseRetractionResponse } from "./parseRetractionResponse";
import { retractionChecks } from "./retractionChecks";
import type { RetractionFacts } from "./retractionChecks";
import { fetchOpenFlagsForRetraction } from "./fetchOpenFlagsForRetraction";
import type { FightToScan } from "./scanFightForRumours";
import type { CandidatePost, OpenFlagForRetraction, RetractionClaim } from "./types";

export interface CardRetractionSummary {
  degradation: Degradation;
  proposedRetractions: number;
  flagsRetracted: number;
}

// A single, card-wide unit -- there is genuinely nothing to decompose
// into per-unit work here (unlike rumour clustering's per-fight map),
// so this uses runMapReduce's map step to make the one real LLM call
// (getting budget/reservation/logging/degradation for free from the
// shared harness) and its reduce step as a pure passthrough -- see
// reduceFallback below and Degradation's "pure" mode in ../llm/types.ts.
interface CardUnit {
  readonly kind: "card";
}
const CARD_UNIT: CardUnit = { kind: "card" };

interface CardFacts {
  flags: OpenFlagForRetraction[];
  posts: CandidatePost[];
}

function toRetractionFacts(facts: CardFacts): RetractionFacts {
  return {
    flagsById: new Map(facts.flags.map((f) => [f.id, f])),
    postsByUri: new Map(facts.posts.map((p) => [p.uri, p])),
  };
}

function buildSpec(facts: CardFacts): MapReduceSpec<CardUnit, RetractionClaim, RetractionClaim, CardFacts> {
  return {
    surface: "rumours",
    units: facts.flags.length > 0 && facts.posts.length > 0 ? [CARD_UNIT] : [],
    facts,
    buildMapPrompt: (_unit, f) => buildRetractionPrompt(f.flags, f.posts),
    parseMapResponse: (text) => parseRetractionResponse(JSON.parse(text)),
    verifyMapClaims: (claims, _unit, f) => verifyClaims(claims, toRetractionFacts(f), retractionChecks),
    // No LLM, no evidence -> propose nothing this run rather than guess.
    // Every existing flag simply stays open, exactly today's behaviour.
    mapFallback: () => [],
    reduceViaLlm: false,
    reduceFallback: (mapped) => mapped[0]?.claims ?? [],
  };
}

/**
 * The card-level retraction pass (Phase N3): reads every currently-open
 * flag plus every post collected across this run's per-fight scans
 * (scanFightForRumours.ts, extended to return its candidatePosts for
 * exactly this purpose), asks whether any flag is now contradicted by
 * real, strictly newer evidence, and applies only the decisions that
 * survive retractionChecks.ts's independent verification.
 *
 * Retraction is additive at the DB level -- `retracted_at is null` is the
 * guard on every UPDATE, so a flag already retracted by a concurrent run
 * (or a second pass finding the same evidence) is simply skipped, not
 * double-written or erred on.
 */
export async function proposeCardRetractions(
  supabase: SupabaseClient,
  deps: MapReduceDeps,
  fights: FightToScan[],
  candidatePosts: CandidatePost[],
): Promise<CardRetractionSummary> {
  const flags = await fetchOpenFlagsForRetraction(supabase, fights);
  const outcome = await runMapReduce(buildSpec({ flags, posts: candidatePosts }), deps);

  let flagsRetracted = 0;
  const retractions = outcome.claims.filter((c) => c.action === "retract");

  for (const claim of retractions) {
    // .select("id") + counting rows returned, not a {count:"exact"} option
    // -- that option is for a plain .select() builder, not a chain after
    // .update(). The .is("retracted_at", null) guard is what makes this
    // idempotent: a flag already retracted (by a concurrent run, or a
    // second pass finding the same evidence) matches zero rows here
    // rather than erroring or double-writing.
    const { data, error } = await supabase
      .from("rumour_flags")
      .update({
        retracted_at: new Date().toISOString(),
        retraction_reason: claim.rationale,
        superseded_by_post_uri: claim.supersededByUri,
      })
      .eq("id", claim.flagId)
      .is("retracted_at", null)
      .select("id");
    if (error) throw error;
    flagsRetracted += data?.length ?? 0;
  }

  return {
    degradation: outcome.degradation,
    proposedRetractions: retractions.length,
    flagsRetracted,
  };
}
