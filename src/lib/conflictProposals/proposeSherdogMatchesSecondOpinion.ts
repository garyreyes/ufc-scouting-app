import type { SupabaseClient } from "@supabase/supabase-js";
import { runMapReduce } from "../llm/runMapReduce";
import { verifyClaims } from "../llm/verifyClaims";
import type { Degradation, MapReduceDeps, MapReduceSpec } from "../llm/runMapReduce";
import { buildSherdogProposalPrompt } from "./buildSherdogProposalPrompt";
import { fetchSherdogConflictsWithPrimaryProposal } from "./fetchSherdogConflictsWithPrimaryProposal";
import { parseSherdogProposalResponse } from "./parseSherdogProposalResponse";
import { sherdogProposalChecks } from "./sherdogProposalChecks";
import type { SherdogProposalFacts } from "./sherdogProposalChecks";
import type { ConflictToPropose, SherdogProposalClaim } from "./types";

export interface ProposeSherdogMatchesSecondOpinionSummary {
  conflictsChecked: number;
  secondOpinionsWritten: number;
  degradation: Degradation;
}

function buildSpec(
  conflicts: ConflictToPropose[],
): MapReduceSpec<ConflictToPropose, SherdogProposalClaim, SherdogProposalClaim, SherdogProposalFacts> {
  const facts: SherdogProposalFacts = { conflictsById: new Map(conflicts.map((c) => [c.conflictId, c])) };

  return {
    surface: "conflicts",
    units: conflicts,
    facts,
    // Same prompt, same evidence -- an independent read of the same
    // facts is the entire point of a second opinion, so the only thing
    // that differs from proposeSherdogMatches.ts is which model answers
    // (wired via `deps`, not here).
    buildMapPrompt: (unit) => buildSherdogProposalPrompt(unit),
    parseMapResponse: (text, unit) => parseSherdogProposalResponse(JSON.parse(text), unit.conflictId),
    verifyMapClaims: (claims, unit, f) => verifyClaims(claims, f, sherdogProposalChecks),
    // No LLM, no evidence -> no second opinion this run; the conflict's
    // primary proposal is untouched and a later run tries again fresh.
    mapFallback: () => [],
    // Unlike reconcileSherdogProposals.ts, a second opinion never writes
    // fighters.sherdog_id and never competes with another conflict for a
    // unique id -- it only annotates its OWN conflict's row, so there is
    // no cross-claim collision to resolve. Pass every kept claim through.
    reduceViaLlm: false,
    reduceFallback: (mapped) => mapped.flatMap((m) => m.claims),
  };
}

/**
 * Phase 2 (Track A): an independent Groq read on every open
 * `low_confidence_sherdog_match` conflict that already has a live primary
 * (Gemini) proposal, recorded alongside it for a human reviewer to see
 * whether the two agree -- never applied, never itself the accepted
 * answer. `fighters.sherdog_id` is never touched here, same as N4.
 */
export async function proposeSherdogMatchesSecondOpinion(
  supabase: SupabaseClient,
  deps: MapReduceDeps,
): Promise<ProposeSherdogMatchesSecondOpinionSummary> {
  const conflicts = await fetchSherdogConflictsWithPrimaryProposal(supabase);
  const outcome = await runMapReduce(buildSpec(conflicts), deps);

  const callLogIdByConflictId = new Map(outcome.mapped.map((m) => [m.unit.conflictId, m.callLogId]));

  let secondOpinionsWritten = 0;
  for (const claim of outcome.claims) {
    const { error } = await supabase
      .from("conflict_resolution_proposals")
      .update({
        second_opinion_action: { chosenSherdogId: claim.chosenSherdogId },
        second_opinion_rationale: claim.rationale,
        second_opinion_llm_call_id: callLogIdByConflictId.get(claim.conflictId) ?? null,
      })
      .eq("conflict_id", claim.conflictId);
    if (error) throw error;
    secondOpinionsWritten++;
  }

  return { conflictsChecked: conflicts.length, secondOpinionsWritten, degradation: outcome.degradation };
}
