import type { FightMethod } from "../../scoring/fightMethod";
import type { ThreeWaySplit } from "../predictInternMethod";

// Phase T3: the Intern's slate, as pure data. Everything here is derived
// from what the Intern already wrote to `picks` (its v2 probability, its
// bet, its method call + distribution) plus the frozen BetOnline price in
// `odds_snapshots` -- the slate forms no new opinion of its own.

export type SlateArchetype = "STRAIGHT_DOG" | "SAFE_PARLAY" | "LONGSHOT" | "METHOD_PARLAY" | "METHOD_SINGLE";

export type SlateMethodGroup = "DECISION" | "KO_TKO_DQ" | "SUBMISSION" | "ANY_FINISH";

export interface SlateFight {
  fightId: string;
  fighter1Id: string;
  fighter2Id: string;
  fighter1Name: string;
  fighter2Name: string;
  // null = unpriced. An unpriced fight is left out of every slip: the
  // Intern's number there is anchored at a flat 50%, not on a market.
  odds: { fighter1Price: number; fighter2Price: number } | null;
  // The picks row as written (after the underdog pick floor, if it fired).
  predictedFighterId: string;
  estimatedProbability: number;
  confidence: number;
  predictedMethod: FightMethod | null;
  methodDistribution: ThreeWaySplit | null;
  // The picks row's own v2 moneyline bet, if its gate fired.
  betFighterId: string | null;
}

export interface SlateLeg {
  fightId: string;
  market: "MONEYLINE" | "METHOD_FIGHTER";
  selectionFighterId: string;
  selectionDetail: string;
  methodGroup: SlateMethodGroup | null;
  price: number;
  // "entered" = the owner typed the real book price over an estimate.
  priceSource: "book" | "estimated" | "entered";
  modelProbability: number;
}

export interface SlateSlip {
  archetype: SlateArchetype;
  // Position within its archetype (value singles are 0..2); part of the
  // generation_key idempotency key.
  index: number;
  legs: SlateLeg[];
  // Product of leg prices, rounded to 3 dp for bet_slips.combined_price --
  // display only; settlement always recomputes from leg prices.
  combinedPrice: number;
  // Product of leg probabilities (legs are always different fights).
  modelProbability: number;
  // Filled in by the staking step.
  stakePhp: number;
}
