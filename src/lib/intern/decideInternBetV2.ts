import { devigTwoWay } from "../scoring/devigTwoWay";
import { edge } from "../scoring/edge";
import { probabilityForFighter } from "../scoring/probabilityForFighter";
import type { InternBetDecision } from "./decideInternBet";

// Phase S2 (ROADMAP_V2.md). v1 bet whenever p x price - 1 >= 5%, which
// selects for model error on longshots: at a 5.20 price a one-point
// probability miss clears it. Over 4 cards v1's bets priced >= 2.00 went
// 1W-10L. v2 needs a real disagreement with the market in PROBABILITY
// points as well as positive EV, refuses long prices outright, and sizes
// by quarter-Kelly instead of a linear edge ramp.

// Minimum gap between the Intern's probability and the de-vigged market's.
export const V2_MIN_PROBABILITY_EDGE = 0.03;
// Minimum expected value per unit staked, at the price actually offered.
export const V2_MIN_EV = 0.03;
// Above this decimal price the Intern's estimation error dominates any edge.
export const V2_MAX_PRICE = 3.5;
// Confidence 1 means p < 0.55 -- no real view on who wins.
export const V2_MIN_CONFIDENCE = 2;

const KELLY_FRACTION = 0.25;
const NOTIONAL_BANKROLL_UNITS = 100;
// A safety floor only: the gates above already imply >= ~0.3u.
export const V2_MIN_STAKE_UNITS = 0.25;
export const V2_MAX_STAKE_UNITS = 2;

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

interface Side {
  fighterId: string;
  probability: number;
  market: number;
  price: number;
}

function qualifies(side: Side): boolean {
  return (
    side.price <= V2_MAX_PRICE &&
    side.probability - side.market >= V2_MIN_PROBABILITY_EDGE &&
    edge(side.probability, side.price) >= V2_MIN_EV
  );
}

function kellyStake(side: Side): number {
  const kelly = edge(side.probability, side.price) / (side.price - 1);
  const units = KELLY_FRACTION * kelly * NOTIONAL_BANKROLL_UNITS;
  const clamped = Math.max(V2_MIN_STAKE_UNITS, Math.min(V2_MAX_STAKE_UNITS, units));
  // numeric(6,2) -- stake_units' own column precision.
  return Math.round(clamped * 100) / 100;
}

/**
 * Same inputs and output shape as decideInternBet (v1), which stays in
 * place unchanged for scoreShadowLines' historical LLM comparison. Since
 * the two sides' probabilities and market probabilities each sum to 1,
 * at most one side can have a positive probability edge -- so at most one
 * side can ever qualify.
 */
export function decideInternBetV2(
  fighter1Id: string,
  fighter2Id: string,
  predictedFighterId: string,
  estimatedProbability: number,
  confidence: number,
  odds: { fighter1Price: number; fighter2Price: number } | null,
): InternBetDecision {
  if (odds === null) {
    return { betFighterId: null, stakeUnits: null, note: "No price yet — can't bet." };
  }
  if (confidence < V2_MIN_CONFIDENCE) {
    return { betFighterId: null, stakeUnits: null, note: "No bet — confidence 1/5 is a coin flip, not a view." };
  }

  const market = devigTwoWay(odds.fighter1Price, odds.fighter2Price);
  const sides: Side[] = [
    {
      fighterId: fighter1Id,
      probability: probabilityForFighter(fighter1Id, predictedFighterId, estimatedProbability),
      market: market.prob1,
      price: odds.fighter1Price,
    },
    {
      fighterId: fighter2Id,
      probability: probabilityForFighter(fighter2Id, predictedFighterId, estimatedProbability),
      market: market.prob2,
      price: odds.fighter2Price,
    },
  ];

  const side = sides.find(qualifies);
  if (!side) {
    const best = sides[0].probability - sides[0].market >= 0 ? sides[0] : sides[1];
    return {
      betFighterId: null,
      stakeUnits: null,
      note:
        `No bet — best read is ${pct(best.probability - best.market)} off market, ` +
        `EV ${pct(edge(best.probability, best.price))} at ${best.price} ` +
        `(needs ≥${pct(V2_MIN_PROBABILITY_EDGE)} and ≥${pct(V2_MIN_EV)}, price ≤${V2_MAX_PRICE}).`,
    };
  }

  const stakeUnits = kellyStake(side);
  return {
    betFighterId: side.fighterId,
    stakeUnits,
    note:
      `Betting ${stakeUnits}u — ${pct(side.probability - side.market)} over market, ` +
      `EV ${pct(edge(side.probability, side.price))} at ${side.price}, confidence ${confidence}/5.`,
  };
}
