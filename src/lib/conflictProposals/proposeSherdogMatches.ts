import type { SupabaseClient } from "@supabase/supabase-js";
import { runMapReduce } from "../llm/runMapReduce";
import { verifyClaims } from "../llm/verifyClaims";
import type { Degradation, MapReduceDeps, MapReduceSpec } from "../llm/runMapReduce";
import { buildSherdogProposalPrompt } from "./buildSherdogProposalPrompt";
import { fetchOpenSherdogConflictsToPropose } from "./fetchOpenSherdogConflictsToPropose";
import { parseSherdogProposalResponse } from "./parseSherdogProposalResponse";
import { reconcileSherdogProposals } from "./reconcileSherdogProposals";
import { sherdogProposalChecks } from "./sherdogProposalChecks";
import type { SherdogProposalFacts } from "./sherdogProposalChecks";
import type { ConflictToPropose, SherdogProposalClaim } from "./types";

export interface ProposeSherdogMatchesSummary {
  conflictsChecked: number;
  proposalsWritten: number;
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
    buildMapPrompt: (unit) => buildSherdogProposalPrompt(unit),
    parseMapResponse: (text, unit) => parseSherdogProposalResponse(JSON.parse(text), unit.conflictId),
    verifyMapClaims: (claims, unit, f) => {
      // A per-conflict map, so parseMapResponse always produces at most
      // one claim -- but verifyClaims needs the whole set to run its
      // per-claim checks against `f`, so this stays generic rather than
      // special-casing "exactly one."
      return verifyClaims(claims, f, sherdogProposalChecks);
    },
    // No LLM, no evidence -> propose nothing for this conflict this run
    // rather than guess. It simply stays exactly as open as before.
    mapFallback: () => [],
    // The reduce step is a PURE function, not an LLM call -- see
    // reconcileSherdogProposals.ts's own header for why.
    reduceViaLlm: false,
    reduceFallback: (mapped) => reconcileSherdogProposals(mapped.flatMap((m) => m.claims)),
  };
}

/**
 * N4: proposes (never applies) a Sherdog-identity match for every
 * currently-open `low_confidence_sherdog_match` conflict. Writes only to
 * `conflict_resolution_proposals` -- `fighters.sherdog_id` is never
 * touched here; the owner still has to click Accept on `/conflicts`,
 * which calls the pre-existing `resolveSherdogMatchAction` unchanged.
 */
export async function proposeSherdogMatches(
  supabase: SupabaseClient,
  deps: MapReduceDeps,
): Promise<ProposeSherdogMatchesSummary> {
  const conflicts = await fetchOpenSherdogConflictsToPropose(supabase);
  const outcome = await runMapReduce(buildSpec(conflicts), deps);

  // A claim's llm_call_id comes from the MappedUnit its conflictId
  // belongs to -- reconcileSherdogProposals can drop claims but never
  // moves one to a different unit, so this lookup is always correct.
  const callLogIdByConflictId = new Map(outcome.mapped.map((m) => [m.unit.conflictId, m.callLogId]));

  let proposalsWritten = 0;
  for (const claim of outcome.claims) {
    const { error } = await supabase.from("conflict_resolution_proposals").upsert(
      {
        conflict_id: claim.conflictId,
        proposed_action: { chosenSherdogId: claim.chosenSherdogId },
        rationale: claim.rationale,
        llm_call_id: callLogIdByConflictId.get(claim.conflictId) ?? null,
      },
      { onConflict: "conflict_id" },
    );
    if (error) throw error;
    proposalsWritten++;
  }

  return { conflictsChecked: conflicts.length, proposalsWritten, degradation: outcome.degradation };
}
