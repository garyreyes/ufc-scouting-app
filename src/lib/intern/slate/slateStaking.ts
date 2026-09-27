import type { SlateArchetype, SlateSlip } from "./types";

// Owner-confirmed 2026-09-28: ~10% of the CURRENT Intern balance per card,
// split across slip types. An archetype with no slip this card keeps its
// share unspent -- a thin card spends less, never the same money on worse
// bets.
export const CARD_BUDGET_FRACTION = 0.1;

export const ARCHETYPE_SHARE: Record<SlateArchetype, number> = {
  STRAIGHT_DOG: 0.3,
  SAFE_PARLAY: 0.3,
  METHOD_SINGLE: 0.15,
  LONGSHOT: 0.125,
  METHOD_PARLAY: 0.125,
};

const KELLY_FRACTION = 0.25;

// Quarter-Kelly fraction of the bankroll for a single-leg bet.
function quarterKelly(slip: SlateSlip): number {
  const [leg] = slip.legs;
  const kelly = (leg.modelProbability * leg.price - 1) / (leg.price - 1);
  return Math.max(0, KELLY_FRACTION * kelly);
}

/**
 * Fills in stakePhp (whole pesos, rounded down so the card never exceeds
 * its budget). Value singles share their slice in proportion to their
 * quarter-Kelly weight, and none is ever staked above its own quarter-Kelly
 * amount -- a single thin edge doesn't get the whole 30% just for being
 * alone. Every other archetype is one slip and takes its whole share.
 */
export function stakeSlate(slips: SlateSlip[], balancePhp: number): SlateSlip[] {
  const budget = CARD_BUDGET_FRACTION * balancePhp;
  const singles = slips.filter((s) => s.archetype === "STRAIGHT_DOG");
  const kellyTotal = singles.reduce((sum, s) => sum + quarterKelly(s), 0);

  return slips.map((s) => {
    const share = ARCHETYPE_SHARE[s.archetype] * budget;
    if (s.archetype !== "STRAIGHT_DOG") return { ...s, stakePhp: Math.floor(share) };
    const k = quarterKelly(s);
    const stake = kellyTotal === 0 ? 0 : Math.min((share * k) / kellyTotal, k * balancePhp);
    return { ...s, stakePhp: Math.floor(stake) };
  });
}
