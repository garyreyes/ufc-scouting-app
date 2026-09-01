import type { FightOutcome } from "./types";

/**
 * Scores the opinion only -- independent of any bet (ARCHITECTURE.md item
 * #3). A void fight scores null, never false: "who wins" has no correct
 * answer when there's no winner, so scoring it wrong would be a bug, not
 * a harsh call (item #8).
 */
export function scorePickCorrect(
  predictedFighterId: string,
  outcome: FightOutcome,
): boolean | null {
  if (outcome.kind === "void") return null;
  return outcome.winnerId === predictedFighterId;
}
