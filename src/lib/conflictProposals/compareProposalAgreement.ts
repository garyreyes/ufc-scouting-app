export type ProposalAgreement = "agree" | "disagree";

/**
 * Phase 2 (Track A): compares N4's primary (Gemini) proposal against the
 * Groq second opinion for the same conflict. Pure and deliberately dumb --
 * "agree" only when both sides land on the exact same answer, including
 * both independently choosing null (neither confident in any candidate).
 * Any mismatch, including one side choosing null while the other names a
 * candidate, is "disagree": a human reviewer reads this badge instead of
 * re-deriving it, so a false "agree" here is strictly worse than a false
 * "disagree" -- it would suppress scrutiny the badge exists to invite.
 */
export function compareProposalAgreement(
  primaryChosenSherdogId: number | null,
  secondOpinionChosenSherdogId: number | null,
): ProposalAgreement {
  return primaryChosenSherdogId === secondOpinionChosenSherdogId ? "agree" : "disagree";
}
