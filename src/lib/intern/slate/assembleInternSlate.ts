import { devigTwoWay } from "../../scoring/devigTwoWay";
import { edge } from "../../scoring/edge";
import { probabilityForFighter } from "../../scoring/probabilityForFighter";
import { estimateMethodPrice, methodGroupFor, methodProbability } from "./estimateMethodPrice";
import { stakeSlate } from "./slateStaking";
import type { SlateArchetype, SlateFight, SlateLeg, SlateMethodGroup, SlateSlip } from "./types";

// Phase T3 (ROADMAP_V2.md): the Intern's per-card slate. Deterministic and
// pure -- same card in, same slips out, regardless of input order (every
// ranking breaks ties by fightId). It invents no opinion: every leg is a
// read the Intern already wrote to `picks`.

const SAFE_MIN_PROBABILITY = 0.65;
// 2, not 3: prelim newcomers are capped at 2 by thin Elo history, and v2's
// number is mostly the market's -- the probability bar does the gating.
const SAFE_MIN_CONFIDENCE = 2;
// "Not against the market": the Intern may be a little under the market
// on a leg it still likes, but not meaningfully.
const SAFE_MAX_UNDER_MARKET = 0.02;
// Below this a leg adds almost nothing to the payout and only risk.
const SAFE_MIN_PRICE = 1.15;
const SAFE_MAX_LEGS = 4;

const LONGSHOT_MIN_PROBABILITY = 0.55;
const LONGSHOT_MIN_LEGS = 5;
const LONGSHOT_MAX_LEGS = 10;

const METHOD_PARLAY_MIN_PROBABILITY = 0.3;
const METHOD_PARLAY_MAX_LEGS = 4;
const METHOD_SINGLE_MIN_PROBABILITY = 0.35;
// A method leg on a heavy favourite prices like a near-lock (a 93% "by
// finish" estimates at 1.18) -- that's not a method bet worth making.
const METHOD_SINGLE_MIN_PRICE = 1.5;
const METHOD_PARLAY_MIN_PRICE = 1.3;

const VALUE_MIN_PRICE = 2;
const VALUE_MAX_SINGLES = 3;

const PARLAY_MIN_LEGS = 2;

const METHOD_LABEL: Record<SlateMethodGroup, string> = {
  DECISION: "decision",
  KO_TKO_DQ: "KO/TKO/DQ",
  SUBMISSION: "submission",
  ANY_FINISH: "finish (KO/TKO or submission)",
};

type PricedFight = SlateFight & { odds: NonNullable<SlateFight["odds"]> };

function nameOf(f: SlateFight, fighterId: string): string {
  return fighterId === f.fighter1Id ? f.fighter1Name : f.fighter2Name;
}

function priceOf(f: PricedFight, fighterId: string): number {
  return fighterId === f.fighter1Id ? f.odds.fighter1Price : f.odds.fighter2Price;
}

// The side the Intern's MODEL favours -- not the floor-forced pick, which
// deliberately backs an underdog it rates below 50%.
function favoured(f: PricedFight): { fighterId: string; probability: number } {
  const p1 = probabilityForFighter(f.fighter1Id, f.predictedFighterId, f.estimatedProbability);
  return p1 >= 0.5 ? { fighterId: f.fighter1Id, probability: p1 } : { fighterId: f.fighter2Id, probability: 1 - p1 };
}

function moneylineLeg(f: PricedFight, fighterId: string, probability: number): SlateLeg {
  return {
    fightId: f.fightId,
    market: "MONEYLINE",
    selectionFighterId: fighterId,
    selectionDetail: `${nameOf(f, fighterId)} to win`,
    methodGroup: null,
    price: priceOf(f, fighterId),
    priceSource: "book",
    modelProbability: probability,
  };
}

function byDescThenFightId<T extends { fightId: string }>(score: (x: T) => number) {
  return (a: T, b: T) => score(b) - score(a) || (a.fightId < b.fightId ? -1 : a.fightId > b.fightId ? 1 : 0);
}

function toSlip(archetype: SlateArchetype, index: number, legs: SlateLeg[]): SlateSlip {
  const combined = legs.reduce((p, l) => p * l.price, 1);
  return {
    archetype,
    index,
    legs,
    combinedPrice: Math.round(combined * 1000) / 1000,
    modelProbability: legs.reduce((p, l) => p * l.modelProbability, 1),
    stakePhp: 0,
  };
}

function valueSingles(fights: PricedFight[]): SlateSlip[] {
  const candidates = fights
    .filter((f) => f.betFighterId !== null && priceOf(f, f.betFighterId) >= VALUE_MIN_PRICE)
    .map((f) => {
      const betId = f.betFighterId!;
      const probability = probabilityForFighter(betId, f.predictedFighterId, f.estimatedProbability);
      return { fightId: f.fightId, leg: moneylineLeg(f, betId, probability), ev: edge(probability, priceOf(f, betId)) };
    })
    .sort(byDescThenFightId((c) => c.ev))
    .slice(0, VALUE_MAX_SINGLES);
  return candidates.map((c, i) => toSlip("STRAIGHT_DOG", i, [c.leg]));
}

function safeParlay(fights: PricedFight[]): SlateSlip[] {
  const legs = fights
    .map((f) => ({ f, side: favoured(f) }))
    .filter(({ f, side }) => {
      const market = devigTwoWay(f.odds.fighter1Price, f.odds.fighter2Price);
      const marketP = side.fighterId === f.fighter1Id ? market.prob1 : market.prob2;
      return (
        side.probability >= SAFE_MIN_PROBABILITY &&
        f.confidence >= SAFE_MIN_CONFIDENCE &&
        side.probability >= marketP - SAFE_MAX_UNDER_MARKET &&
        priceOf(f, side.fighterId) >= SAFE_MIN_PRICE
      );
    })
    .map(({ f, side }) => moneylineLeg(f, side.fighterId, side.probability))
    .sort(byDescThenFightId((l) => l.modelProbability))
    .slice(0, SAFE_MAX_LEGS);
  return legs.length >= PARLAY_MIN_LEGS ? [toSlip("SAFE_PARLAY", 0, legs)] : [];
}

function longshotParlay(fights: PricedFight[]): SlateSlip[] {
  const ranked = fights
    .map((f) => {
      const side = favoured(f);
      return moneylineLeg(f, side.fighterId, side.probability);
    })
    .sort(byDescThenFightId((l) => l.modelProbability));
  const confident = ranked.filter((l) => l.modelProbability >= LONGSHOT_MIN_PROBABILITY).length;
  const legs = ranked.slice(0, Math.min(LONGSHOT_MAX_LEGS, Math.max(LONGSHOT_MIN_LEGS, confident)));
  return legs.length >= LONGSHOT_MIN_LEGS ? [toSlip("LONGSHOT", 0, legs)] : [];
}

function methodLegs(fights: PricedFight[]): SlateLeg[] {
  const legs: SlateLeg[] = [];
  for (const f of fights) {
    if (f.predictedMethod === null || f.methodDistribution === null) continue;
    const group = methodGroupFor(f.predictedMethod);
    const probability = methodProbability(f.estimatedProbability, group, f.methodDistribution);
    legs.push({
      fightId: f.fightId,
      market: "METHOD_FIGHTER",
      selectionFighterId: f.predictedFighterId,
      selectionDetail: `${nameOf(f, f.predictedFighterId)} by ${METHOD_LABEL[group]}`,
      methodGroup: group,
      price: estimateMethodPrice(probability),
      priceSource: "estimated",
      modelProbability: probability,
    });
  }
  return legs.sort(byDescThenFightId((l) => l.modelProbability));
}

function methodSlips(fights: PricedFight[]): SlateSlip[] {
  const ranked = methodLegs(fights);
  const slips: SlateSlip[] = [];
  const parlayLegs = ranked
    .filter((l) => l.modelProbability >= METHOD_PARLAY_MIN_PROBABILITY && l.price >= METHOD_PARLAY_MIN_PRICE)
    .slice(0, METHOD_PARLAY_MAX_LEGS);
  if (parlayLegs.length >= PARLAY_MIN_LEGS) slips.push(toSlip("METHOD_PARLAY", 0, parlayLegs));
  const single = ranked.find((l) => l.price >= METHOD_SINGLE_MIN_PRICE);
  if (single && single.modelProbability >= METHOD_SINGLE_MIN_PROBABILITY) {
    slips.push(toSlip("METHOD_SINGLE", 0, [single]));
  }
  return slips;
}

/**
 * The whole slate for one card, staked against `balancePhp` (the Intern's
 * current bankroll). Slip types that can't be built honestly -- too few
 * qualifying legs -- are left out rather than padded with weaker legs.
 */
export function assembleInternSlate(card: SlateFight[], balancePhp: number): SlateSlip[] {
  if (balancePhp <= 0) return [];
  const priced = card
    .filter((f): f is PricedFight => f.odds !== null)
    .sort((a, b) => (a.fightId < b.fightId ? -1 : a.fightId > b.fightId ? 1 : 0));

  const slips = [
    ...valueSingles(priced),
    ...safeParlay(priced),
    ...longshotParlay(priced),
    ...methodSlips(priced),
  ];
  return stakeSlate(slips, balancePhp).filter((s) => s.stakePhp >= 1);
}
