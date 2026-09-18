import type { ClaimCheck } from "../llm/types";
import type { ScoutingDossierClaim, ScoutingFighterBundle } from "./types";

export interface ScoutingDossierFacts {
  bundlesByFighterId: Map<string, ScoutingFighterBundle>;
}

// fighterId is never model-generated (buildScoutingDossierPrompt.ts is a
// per-fighter prompt, and parseScoutingDossierResponse.ts sets fighterId
// from the unit being mapped) -- defense-in-depth against a future
// refactor bug, not a hallucination this model could actually produce
// today. Mirrors sherdogProposalChecks.ts's conflictIsReal.
const fighterIsReal: ClaimCheck<ScoutingDossierClaim, ScoutingDossierFacts> = (claim, facts) =>
  facts.bundlesByFighterId.has(claim.fighterId) ? { ok: true, claim } : { ok: false, reason: "unknown_fighter_id" };

// A cited bout must be real for THIS fighter's own recent-bout list --
// never merely present in some other fighter's bundle. Drops the whole
// claim rather than narrowing (unlike parseClusterResponse.ts's sourceUris
// filter): a fabricated citation means the prose written around it may
// already be reasoning from a bout that doesn't exist, which is
// disqualifying for the whole dossier, not just the citation list.
const citedBoutsAreReal: ClaimCheck<ScoutingDossierClaim, ScoutingDossierFacts> = (claim, facts) => {
  const bundle = facts.bundlesByFighterId.get(claim.fighterId)!;
  const realIds = new Set(bundle.recentBouts.map((b) => b.id));
  const allReal = claim.citedBoutIds.every((id) => realIds.has(id));
  return allReal ? { ok: true, claim } : { ok: false, reason: "fabricated_bout_id" };
};

// Same reasoning as citedBoutsAreReal, for open rumour flags.
const citedFlagsAreReal: ClaimCheck<ScoutingDossierClaim, ScoutingDossierFacts> = (claim, facts) => {
  const bundle = facts.bundlesByFighterId.get(claim.fighterId)!;
  const realIds = new Set(bundle.openFlags.map((f) => f.id));
  const allReal = claim.citedFlagIds.every((id) => realIds.has(id));
  return allReal ? { ok: true, claim } : { ok: false, reason: "fabricated_flag_id" };
};

export const scoutingDossierChecks: ClaimCheck<ScoutingDossierClaim, ScoutingDossierFacts>[] = [
  fighterIsReal,
  citedBoutsAreReal,
  citedFlagsAreReal,
];
