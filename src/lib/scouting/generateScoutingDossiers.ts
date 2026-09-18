import type { SupabaseClient } from "@supabase/supabase-js";
import { runMapReduce } from "../llm/runMapReduce";
import { verifyClaims } from "../llm/verifyClaims";
import type { Degradation, MapReduceDeps, MapReduceSpec } from "../llm/runMapReduce";
import { buildScoutingDossierPrompt } from "./buildScoutingDossierPrompt";
import { fetchFightersNeedingDossiers } from "./fetchFightersNeedingDossiers";
import { parseScoutingDossierResponse } from "./parseScoutingDossierResponse";
import { scoutingDossierChecks } from "./scoutingDossierChecks";
import type { ScoutingDossierFacts } from "./scoutingDossierChecks";
import type { FighterNeedingDossier, ScoutingDossierClaim, ScoutingFighterBundle } from "./types";

export interface GenerateScoutingDossiersSummary {
  // Cache misses only -- fetchFightersNeedingDossiers.ts already filters
  // out every fighter whose current dossier is still valid, so this is
  // never the full roster on a quiet day (most days, per the budget math
  // in ROADMAP.md's N7 entry).
  fightersNeedingDossier: number;
  dossiersWritten: number;
  degradation: Degradation;
}

function buildSpec(
  needing: FighterNeedingDossier[],
): MapReduceSpec<ScoutingFighterBundle, ScoutingDossierClaim, ScoutingDossierClaim, ScoutingDossierFacts> {
  const bundles = needing.map((n) => n.bundle);
  const facts: ScoutingDossierFacts = { bundlesByFighterId: new Map(bundles.map((b) => [b.fighterId, b])) };

  return {
    surface: "scouting",
    units: bundles,
    facts,
    buildMapPrompt: (unit) => buildScoutingDossierPrompt(unit),
    parseMapResponse: (text, unit) => parseScoutingDossierResponse(JSON.parse(text), unit.fighterId),
    verifyMapClaims: (claims, unit, f) => verifyClaims(claims, f, scoutingDossierChecks),
    // No LLM, no dossier this run -- the fighter's existing dossier row
    // (if any) simply stays as it was, exactly N4's "no evidence -> propose
    // nothing" posture. N8 (not built yet) is what reads the most recent
    // row per fighter regardless of how old it is; N7's own write step has
    // no reason to fabricate a "serve stale" branch for a reduce consumer
    // that doesn't exist yet.
    mapFallback: () => [],
    // Dossiers don't reduce across fighters -- each one is independent, so
    // this is a pure passthrough, not an aggregation. Mirrors N4's
    // reduceViaLlm: false posture for the same reason: nothing here is a
    // judgment call code can't already make deterministically.
    reduceViaLlm: false,
    reduceFallback: (mapped) => mapped.flatMap((m) => m.claims),
  };
}

/**
 * N7: writes one scouting dossier per fighter on the nearest upcoming
 * card whose input bundle has actually changed since its last dossier
 * (or who has never had one). Pure map step -- N8's reduce (shadow picks)
 * is a later sub-phase and has no code here yet.
 */
export async function generateScoutingDossiers(
  supabase: SupabaseClient,
  deps: MapReduceDeps,
): Promise<GenerateScoutingDossiersSummary> {
  const needing = await fetchFightersNeedingDossiers(supabase);
  const outcome = await runMapReduce(buildSpec(needing), deps);

  const callLogIdByFighterId = new Map(outcome.mapped.map((m) => [m.unit.fighterId, m.callLogId]));
  const inputHashByFighterId = new Map(needing.map((n) => [n.bundle.fighterId, n.inputHash]));

  let dossiersWritten = 0;
  for (const claim of outcome.claims) {
    const { error } = await supabase.from("fighter_scouting_dossiers").insert({
      fighter_id: claim.fighterId,
      input_hash: inputHashByFighterId.get(claim.fighterId),
      form_trajectory: claim.formTrajectory,
      stylistic_profile: claim.stylisticProfile,
      durability: claim.durability,
      layoff: claim.layoff,
      cited_bout_ids: claim.citedBoutIds,
      cited_flag_ids: claim.citedFlagIds,
      llm_call_id: callLogIdByFighterId.get(claim.fighterId) ?? null,
    });
    if (error) throw error;
    dossiersWritten++;
  }

  return {
    fightersNeedingDossier: needing.length,
    dossiersWritten,
    degradation: outcome.degradation,
  };
}
