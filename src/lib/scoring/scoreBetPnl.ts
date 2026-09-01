import type { FightOutcome } from "./types";

/**
 * Scores the money only -- independent of the prediction (ARCHITECTURE.md
 * item #3). Settles against betFighterId, never predictedFighterId; a
 * bet may back a different fighter than the pick, and this function has
 * no way to even see the prediction, which is what makes that
 * independence structural rather than a convention to remember.
 *
 * null (no bet was placed, docs/PRD.md's "no stake required") and 0 (a
 * void outcome, stake returned) are deliberately different values -- one
 * means "nothing to show," the other means "a real, recorded net-zero
 * outcome." Collapsing them would make a voided bet indistinguishable
 * from one that was never placed.
 */
export function scoreBetPnl(
  betFighterId: string | null,
  stakeUnits: number | null,
  decimalPrice: number,
  outcome: FightOutcome,
): number | null {
  if (betFighterId === null || stakeUnits === null) return null;
  if (outcome.kind === "void") return 0;
  if (outcome.winnerId === betFighterId) {
    return stakeUnits * (decimalPrice - 1);
  }
  return -stakeUnits;
}
