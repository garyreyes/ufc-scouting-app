import type { FightMethod } from "../../scoring/fightMethod";
import type { ThreeWaySplit } from "../predictInternMethod";
import type { SlateMethodGroup } from "./types";

// No method-of-victory odds feed exists (PROJECT_FACTS.md: The Odds API,
// Cito and ParlayAPI all verified live). Method legs are therefore priced
// from the Intern's own probability, loaded with a typical prop-market
// margin so the paper bankroll isn't credited with fair odds no book
// offers. The owner can overwrite any estimated leg with the real book
// price before the lock (price_source 'entered').
export const PROP_MARGIN = 0.2;

const MIN_PRICE = 1.01;

export function estimateMethodPrice(probability: number): number {
  const raw = 1 / (probability * (1 + PROP_MARGIN));
  return Math.max(MIN_PRICE, Math.round(raw * 100) / 100);
}

// The Intern's method call -> the settleable bet_legs.method_group.
// FINISH ("ends early, unclear how") is exactly ANY_FINISH.
export function methodGroupFor(method: FightMethod): SlateMethodGroup {
  switch (method) {
    case "DECISION":
      return "DECISION";
    case "KO_TKO":
      return "KO_TKO_DQ";
    case "SUBMISSION":
      return "SUBMISSION";
    case "FINISH":
      return "ANY_FINISH";
  }
}

/**
 * P(this fighter wins by this method) = P(win) x P(fight ends this way).
 * Treats the method split as independent of which fighter wins -- the
 * same approximation predictInternMethod's distribution already makes.
 */
export function methodProbability(winProbability: number, group: SlateMethodGroup, dist: ThreeWaySplit): number {
  const share =
    group === "DECISION" ? dist.dec : group === "KO_TKO_DQ" ? dist.ko : group === "SUBMISSION" ? dist.sub : dist.ko + dist.sub;
  return winProbability * share;
}
