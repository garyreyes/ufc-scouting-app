// Shared shapes for the N4 Sherdog-match proposal pipeline
// (buildSherdogProposalPrompt.ts, parseSherdogProposalResponse.ts,
// sherdogProposalChecks.ts, reconcileSherdogProposals.ts,
// proposeSherdogMatches.ts). Mirrors lib/rumours' own file layout.

// The map unit -- one open low_confidence_sherdog_match conflict, with
// only what the prompt and the checks actually need (not the full
// LowConfidenceSherdogMatchConflict shape, which carries UI-only fields).
export interface SherdogMatchCandidateForProposal {
  sherdogId: number;
  name: string;
  confidence: number;
  nickname: string | null;
  association: string | null;
}

export interface ConflictToPropose {
  conflictId: string;
  storedName: string;
  reason: "below_threshold" | "ambiguous" | "guard_mismatch";
  guardMismatchPageName?: string;
  candidates: SherdogMatchCandidateForProposal[];
}

// The model's per-conflict decision, before ground-truth checking.
// chosenSherdogId null means "none of the candidates are a confident
// match" -- a real, safe answer, not a parse failure.
export interface SherdogProposalClaim {
  conflictId: string;
  chosenSherdogId: number | null;
  rationale: string;
}
