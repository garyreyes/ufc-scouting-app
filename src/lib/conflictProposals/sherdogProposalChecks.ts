import type { ClaimCheck } from "../llm/types";
import type { ConflictToPropose, SherdogProposalClaim } from "./types";

export interface SherdogProposalFacts {
  conflictsById: Map<string, ConflictToPropose>;
}

// conflictId itself is never model-generated (buildSherdogProposalPrompt.ts
// is a per-conflict prompt, and parseSherdogProposalResponse.ts sets
// conflictId from the unit being mapped, not from the model's response) --
// so this check is defense-in-depth against a future refactor bug, not a
// hallucination this model could actually produce today.
const conflictIsReal: ClaimCheck<SherdogProposalClaim, SherdogProposalFacts> = (claim, facts) =>
  facts.conflictsById.has(claim.conflictId) ? { ok: true, claim } : { ok: false, reason: "unknown_conflict_id" };

// The load-bearing check: never trust an invented sherdogId, and never
// trust a real sherdogId cited for the WRONG conflict -- checked against
// THIS claim's own conflict's real candidate list, not any candidate list
// in facts.
const candidateIsReal: ClaimCheck<SherdogProposalClaim, SherdogProposalFacts> = (claim, facts) => {
  if (claim.chosenSherdogId === null) return { ok: true, claim };
  const conflict = facts.conflictsById.get(claim.conflictId)!;
  const isReal = conflict.candidates.some((c) => c.sherdogId === claim.chosenSherdogId);
  return isReal ? { ok: true, claim } : { ok: false, reason: "unknown_candidate" };
};

export const sherdogProposalChecks: ClaimCheck<SherdogProposalClaim, SherdogProposalFacts>[] = [
  conflictIsReal,
  candidateIsReal,
];
