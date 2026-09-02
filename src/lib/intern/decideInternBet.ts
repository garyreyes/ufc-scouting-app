import { edge } from "../scoring/edge";
import { probabilityForFighter } from "../scoring/probabilityForFighter";

// Below this, PRD UC-3's own example (a -6000 favourite, 98.4% implied)
// is the case this exists to catch: silence on an unbackable favourite
// is the intern working, not failing. 5% is a real, if arbitrary,
// margin above zero -- estimation error in the intern's own probability
// is real, so requiring a meaningful edge before committing simulated
// capital is more honest than betting the instant edge crosses exactly
// zero.
export const EDGE_THRESHOLD = 0.05;

// A bet that just clears the threshold still gets a real, non-trivial
// stake -- there's no reason for the smallest qualifying bet to be an
// arbitrarily tiny fraction of a unit.
export const MIN_STAKE_UNITS = 0.5;

// A hard ceiling regardless of how large the edge or confidence gets --
// PRD's "the intern sizes its own simulated stakes" is not a licence for
// one outlier read to dump an unrealistic number of units on a single
// fight. Comparable in scale to the chalk line's flat 1u, high enough
// that a genuinely strong read can still separate itself from it.
export const MAX_STAKE_UNITS = 3;

// Edge beyond the threshold that reaches MAX_STAKE_UNITS (before the
// confidence multiplier below) -- a 25% edge is already a very large,
// rare read; scaling stops getting steeper past that rather than
// rewarding an even more extreme number with an even bigger bet.
const EDGE_AT_MAX_STAKE = 0.25;

// User-confirmed 2026-09-02: bet size reflects genuine conviction, not
// just raw edge -- two equal-edge bets should NOT get equal stakes if
// one rests on a near-debutant matchup (G1b's thin-history confidence
// cap) and the other on a well-established one. Linear, confidence 1
// through 5 mapping to 0.4x through 1.2x -- confidence 3 (the old
// un-capped midpoint) lands almost exactly at 1x, so this doesn't shift
// already-well-supported bets much, only ones G1b's own cap already
// flagged as thin.
function confidenceMultiplier(confidence: number): number {
  return 0.2 * confidence + 0.2;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export interface InternBetDecision {
  betFighterId: string | null;
  stakeUnits: number | null;
  note: string;
}

/**
 * UC-3's second judgment, deliberately separate from decideInternPick.ts
 * -- docs/PRD.md UC-2: "A pick and a bet are two different judgments and
 * must not be collapsed." Checks edge on BOTH fighters, not just the
 * predicted one -- probabilityForFighter.ts already exists precisely
 * because a bet may back a different fighter than the pick (C4's own
 * finding), and there's no reason to assume the predicted fighter always
 * carries the better price without actually checking.
 *
 * Correctness-critical (ARCHITECTURE.md item #2): this is what decides
 * whether real (simulated) units move at all.
 */
export function decideInternBet(
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

  const probability1 = probabilityForFighter(fighter1Id, predictedFighterId, estimatedProbability);
  const probability2 = probabilityForFighter(fighter2Id, predictedFighterId, estimatedProbability);
  const edge1 = edge(probability1, odds.fighter1Price);
  const edge2 = edge(probability2, odds.fighter2Price);

  const betOnFighter1 = edge1 >= edge2;
  const bestFighterId = betOnFighter1 ? fighter1Id : fighter2Id;
  const bestEdge = betOnFighter1 ? edge1 : edge2;

  if (bestEdge < EDGE_THRESHOLD) {
    return {
      betFighterId: null,
      stakeUnits: null,
      note: `No bet — best edge ${pct(bestEdge)} is below the ${pct(EDGE_THRESHOLD)} threshold.`,
    };
  }

  const stakeUnits = sizeStake(bestEdge, confidence);
  return {
    betFighterId: bestFighterId,
    stakeUnits,
    note: `Betting ${stakeUnits}u — edge ${pct(bestEdge)}, confidence ${confidence}/5.`,
  };
}

function sizeStake(edgeValue: number, confidence: number): number {
  const clampedEdge = Math.min(edgeValue, EDGE_AT_MAX_STAKE);
  const fractionOfMax = (clampedEdge - EDGE_THRESHOLD) / (EDGE_AT_MAX_STAKE - EDGE_THRESHOLD);
  const baseStake = MIN_STAKE_UNITS + fractionOfMax * (MAX_STAKE_UNITS - MIN_STAKE_UNITS);
  const sized = baseStake * confidenceMultiplier(confidence);
  const clamped = Math.max(MIN_STAKE_UNITS, Math.min(MAX_STAKE_UNITS, sized));
  // numeric(6,2) -- stake_units' own column precision.
  return Math.round(clamped * 100) / 100;
}
