import { MAX_TOTAL_ADJUSTMENT } from "../intern/decideInternPick";
import { MAX_AGE_ADJUSTMENT } from "../intern/ageAdjustment";
import { MAX_PENALTY_PER_FIGHTER } from "../intern/flagPenalty";
import { MAX_SIZE_ADJUSTMENT } from "../intern/sizeAdjustment";
import { MAX_ELO_ADJUSTMENT } from "../elo/eloAdjustment";
import type { ClaimCheck } from "../llm/types";
import type { ShadowPickClaim, ShadowPickFacts, ShadowPickFightFacts } from "./types";

// Exact-equality restatement check, not fuzzy -- the model is given every
// one of these numbers verbatim (buildShadowPicksPrompt.ts) and asked
// only to repeat them, so any mismatch (including a null field restated
// as a number, or vice versa) means the model wasn't actually reading the
// facts it was handed. Elo is rounded before comparison because the
// prompt itself gives a rounded Elo (matching buildScoutingDossierPrompt's
// own `Math.round`), so restating the rounded value back is correct, not
// lossy.
function numericsMatch(fight: ShadowPickFightFacts, restated: ShadowPickClaim["restated"]): boolean {
  const pairs: [number | null, number | null][] = [
    [restated.fighter1Elo, Math.round(fight.fighter1.eloRating)],
    [restated.fighter2Elo, Math.round(fight.fighter2.eloRating)],
    [restated.fighter1Reach, fight.fighter1.reachCm],
    [restated.fighter2Reach, fight.fighter2.reachCm],
    [restated.fighter1Height, fight.fighter1.heightCm],
    [restated.fighter2Height, fight.fighter2.heightCm],
    [restated.fighter1Age, fight.fighter1.ageYears],
    [restated.fighter2Age, fight.fighter2.ageYears],
    [restated.fighter1Wins, fight.fighter1.sherdogWins],
    [restated.fighter1Losses, fight.fighter1.sherdogLosses],
    [restated.fighter2Wins, fight.fighter2.sherdogWins],
    [restated.fighter2Losses, fight.fighter2.sherdogLosses],
    [restated.fighter1Price, fight.fighter1Price],
    [restated.fighter2Price, fight.fighter2Price],
  ];
  return pairs.every(([claimed, real]) => claimed === real);
}

const fightIsReal: ClaimCheck<ShadowPickClaim, ShadowPickFacts> = (claim, facts) =>
  facts.fightsById.has(claim.fightId) ? { ok: true, claim } : { ok: false, reason: "unknown_fight_id" };

// The single cheapest, most valuable check in the phase (plan's own
// Risks section): catches a model reasoning fluently from a number it
// misread, which no amount of prose quality would otherwise reveal.
const numericRestatementMatches: ClaimCheck<ShadowPickClaim, ShadowPickFacts> = (claim, facts) => {
  const fight = facts.fightsById.get(claim.fightId)!;
  return numericsMatch(fight, claim.restated) ? { ok: true, claim } : { ok: false, reason: "numeric_mismatch" };
};

// Drops the whole claim rather than narrowing, same posture
// scoutingDossierChecks.ts already takes: a fabricated citation means the
// deltas and reasoning built around it may already be reasoning from
// something that doesn't exist.
const citedBoutsAreReal: ClaimCheck<ShadowPickClaim, ShadowPickFacts> = (claim, facts) => {
  const fight = facts.fightsById.get(claim.fightId)!;
  const realIds = new Set([...fight.fighter1.recentBouts.map((b) => b.id), ...fight.fighter2.recentBouts.map((b) => b.id)]);
  const allReal = claim.citedBoutIds.every((id) => realIds.has(id));
  return allReal ? { ok: true, claim } : { ok: false, reason: "fabricated_bout_id" };
};

const citedFlagsAreReal: ClaimCheck<ShadowPickClaim, ShadowPickFacts> = (claim, facts) => {
  const fight = facts.fightsById.get(claim.fightId)!;
  const realIds = new Set([...fight.fighter1.openFlags.map((f) => f.id), ...fight.fighter2.openFlags.map((f) => f.id)]);
  const allReal = claim.citedFlagIds.every((id) => realIds.has(id));
  return allReal ? { ok: true, claim } : { ok: false, reason: "fabricated_flag_id" };
};

// Each signal bounded by the SAME cap decideInternPick.ts's own signals
// carry (rumours ±0.12, Elo ±0.15, size ±0.06, age ±0.04) -- checked here
// as a hard drop, not silently re-clamped, so a model that overshoots one
// signal never quietly gets rewritten into a different, unreviewed claim.
const deltasWithinSignalCaps: ClaimCheck<ShadowPickClaim, ShadowPickFacts> = (claim) => {
  const { rumours, elo, size, age } = claim.deltas;
  const withinCaps =
    Math.abs(rumours) <= MAX_PENALTY_PER_FIGHTER &&
    Math.abs(elo) <= MAX_ELO_ADJUSTMENT &&
    Math.abs(size) <= MAX_SIZE_ADJUSTMENT &&
    Math.abs(age) <= MAX_AGE_ADJUSTMENT;
  return withinCaps ? { ok: true, claim } : { ok: false, reason: "delta_over_signal_cap" };
};

// The combined-signal ceiling (decideInternPick.ts's MAX_TOTAL_ADJUSTMENT,
// 0.25) -- a stack of agreeing signals, each individually within its own
// cap, can still sum past this. applyShadowPickClaims.ts intentionally
// does NOT re-clamp a claim that fails this: an over-cap proposal is
// dropped whole here, not silently rewritten to a different number.
const sumWithinTotalAdjustment: ClaimCheck<ShadowPickClaim, ShadowPickFacts> = (claim) => {
  const { rumours, elo, size, age } = claim.deltas;
  const sum = rumours + elo + size + age;
  return Math.abs(sum) <= MAX_TOTAL_ADJUSTMENT ? { ok: true, claim } : { ok: false, reason: "sum_over_max_adjustment" };
};

// Strict (0, 1), matching the plan's own wording exactly -- distinct from
// applyProbabilityDelta.ts's (0.01, 0.99), since that clamp exists to
// keep a MARKET-ANCHORED number off the boundary; the LLM_ONLY line has
// no anchor to protect and 0 or 1 here would mean the model claimed
// certainty, which is never legitimate.
const freeProbabilityInRange: ClaimCheck<ShadowPickClaim, ShadowPickFacts> = (claim) => {
  const p = claim.freeProbabilityFighter1;
  return p > 0 && p < 1 ? { ok: true, claim } : { ok: false, reason: "probability_out_of_range" };
};

export const shadowPickClaimChecks: ClaimCheck<ShadowPickClaim, ShadowPickFacts>[] = [
  fightIsReal,
  numericRestatementMatches,
  citedBoutsAreReal,
  citedFlagsAreReal,
  deltasWithinSignalCaps,
  sumWithinTotalAdjustment,
  freeProbabilityInRange,
];
