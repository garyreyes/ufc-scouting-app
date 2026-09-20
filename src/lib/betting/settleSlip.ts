import type { LegSettlement } from "./settleLeg";

// "pending" is bet_legs.leg_result's own default (a leg nobody has tried
// to settle yet); "undetermined" is settleLeg's verdict that it TRIED
// and could not decide. They roll up identically here, but they mean
// different things and the distinction is worth keeping at the boundary.
export type LegRollupResult = LegSettlement | "pending";

export interface LegForRollup {
  result: LegRollupResult;
  // The price actually taken on this leg, not the slip's displayed
  // combined odds.
  price: number;
}

export type SlipRollup =
  | { status: "open" }
  | { status: "won"; payoutPhp: number }
  | { status: "lost"; payoutPhp: number }
  | { status: "void"; payoutPhp: number };

// numeric(10,2) is the column's own precision, and pesos do not have
// fractions of a centavo.
function toCentavos(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Rolls a slip's legs up into its status and the total returned (stake
 * included).
 *
 * The payout is computed from the LEG PRICES, never from the slip's
 * displayed combined odds -- books round what they display. One of the
 * owner's real tickets proves the difference matters: it shows combined
 * odds of 4.475 on P100 but paid P447.55, which is 1.68 x 2.664 taken to
 * full precision, not the rounded figure on the ticket face.
 *
 * Void legs drop out and the slip reprices on whatever survives, which
 * is the standard book rule and the subtlest money path here: a voided
 * leg neither pays at the original combined odds nor kills the slip.
 */
export function settleSlip(legs: LegForRollup[], stakePhp: number): SlipRollup {
  if (legs.length === 0) return { status: "open" };

  // A parlay cannot recover. Checked first so a slip settles the moment
  // it is dead, rather than waiting on legs whose results can no longer
  // change anything.
  if (legs.some((leg) => leg.result === "lost")) return { status: "lost", payoutPhp: 0 };

  if (legs.some((leg) => leg.result === "pending" || leg.result === "undetermined")) {
    return { status: "open" };
  }

  const surviving = legs.filter((leg) => leg.result === "won");
  // Everything voided: the stake comes back untouched.
  if (surviving.length === 0) return { status: "void", payoutPhp: toCentavos(stakePhp) };

  const combinedPrice = surviving.reduce((product, leg) => product * leg.price, 1);
  return { status: "won", payoutPhp: toCentavos(stakePhp * combinedPrice) };
}
