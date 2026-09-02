import { expectedScore } from "./eloMath";

// Somewhat larger than flagPenalty.ts's MAX_PENALTY_PER_FIGHTER (0.12):
// an Elo rating reflects a fighter's whole rated UFC history, not one
// concern, so it's reasonable for it to carry a bit more weight. Still
// bounded well short of dominating the market anchor -- this stays "one
// more reason to deviate," not a second, equal-weight prediction the
// market gets averaged against. docs/PRD.md UC-3: "anchors on the
// market and deviates when its own scouting gives it a reason to."
export const MAX_ELO_ADJUSTMENT = 0.15;

/**
 * Converts an Elo rating gap into a bounded probability-point shift, in
 * the same additive-adjustment shape lib/intern/flagPenalty.ts already
 * uses for rumour flags. Deliberately does NOT let the raw Elo-implied
 * probability substitute for the market anchor outright -- a huge
 * rating gap (a 400-point gap implies ~91%/9% on its own) would
 * otherwise be able to overwhelm or flip the market's own read entirely,
 * which is a bigger claim than "one signal among several" should be
 * allowed to make on its own.
 */
export function eloAdjustment(ratingFighter1: number, ratingFighter2: number): number {
  const eloImpliedProbability1 = expectedScore(ratingFighter1, ratingFighter2);
  const rawShift = eloImpliedProbability1 - 0.5;
  return Math.max(-MAX_ELO_ADJUSTMENT, Math.min(MAX_ELO_ADJUSTMENT, rawShift));
}
