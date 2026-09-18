import { confidenceFor, MAX_TOTAL_ADJUSTMENT } from "../intern/decideInternPick";
import { applyProbabilityDelta } from "../scoring/applyProbabilityDelta";
import { devigTwoWay } from "../scoring/devigTwoWay";
import type { MappedUnit } from "../llm/runMapReduce";
import type { ShadowPickCardUnit, ShadowPickClaim, ShadowPickFacts, ShadowPickResult } from "./types";

/**
 * N8's `reduceFallback` (`reduceViaLlm: false` -- this is a PURE
 * function, never a second model call). "The model never emits a
 * probability for the assisted line" (plan, N8): it only proposes signed
 * deltas, verified in-bounds by `shadowPickClaimChecks.ts`, and this is
 * the ONLY place a delta becomes a probability -- through the exact same
 * `applyProbabilityDelta`/`MAX_TOTAL_ADJUSTMENT` clamp and
 * `confidenceFor` banding `decideInternPick.ts` uses for real picks, so
 * the comparison is over identical math, not a second invented scale.
 *
 * Re-clamps the delta sum here too (defense-in-depth): a claim whose
 * signals are each individually within cap but sum past
 * `MAX_TOTAL_ADJUSTMENT` should already have been dropped by
 * `shadowPickClaimChecks.ts` before this ever runs, but this function
 * must never trust that and apply a raw, unclamped sum regardless.
 *
 * One claim produces two independent rows -- `LLM_ASSISTED` (bounded,
 * market-anchored, has a confidence band) and `LLM_ONLY` (the model's own
 * unconstrained `freeProbabilityFighter1`, clamped only by
 * `shadowPickClaimChecks.ts`'s strict-(0,1) check, no confidence).
 */
export function applyShadowPickClaims(
  mapped: MappedUnit<ShadowPickCardUnit, ShadowPickClaim>[],
  facts: ShadowPickFacts,
): ShadowPickResult[] {
  const results: ShadowPickResult[] = [];

  for (const unit of mapped) {
    for (const claim of unit.claims) {
      const fight = facts.fightsById.get(claim.fightId);
      if (!fight) continue; // shadowPickClaimChecks.ts already guarantees this; defense-in-depth only

      const { rumours, elo, size, age } = claim.deltas;
      const sumDelta = rumours + elo + size + age;
      const clampedDelta = Math.max(-MAX_TOTAL_ADJUSTMENT, Math.min(MAX_TOTAL_ADJUSTMENT, sumDelta));

      const anchor1 =
        fight.fighter1Price !== null && fight.fighter2Price !== null
          ? devigTwoWay(fight.fighter1Price, fight.fighter2Price).prob1
          : 0.5; // Fork 10: unpriced fights still get a pick, anchored at an even 50%.

      const probability1 = applyProbabilityDelta(anchor1, clampedDelta);
      const assistedPicksFighter1 = probability1 >= 0.5; // decideInternPick.ts's own tie-break convention
      const assistedProbability = assistedPicksFighter1 ? probability1 : 1 - probability1;
      const minRatedFightCount = Math.min(fight.fighter1.ratedFightCount, fight.fighter2.ratedFightCount);

      results.push({
        fightId: claim.fightId,
        line: "LLM_ASSISTED",
        predictedFighterId: assistedPicksFighter1 ? fight.fighter1.fighterId : fight.fighter2.fighterId,
        probability: assistedProbability,
        confidence: confidenceFor(assistedProbability, minRatedFightCount),
        signals: { rumours, elo, size, age, sumDelta: clampedDelta },
        reasoning: claim.reasoning,
        llmCallId: unit.callLogId,
      });

      const freeProbability1 = claim.freeProbabilityFighter1;
      const onlyPicksFighter1 = freeProbability1 >= 0.5;
      results.push({
        fightId: claim.fightId,
        line: "LLM_ONLY",
        predictedFighterId: onlyPicksFighter1 ? fight.fighter1.fighterId : fight.fighter2.fighterId,
        probability: onlyPicksFighter1 ? freeProbability1 : 1 - freeProbability1,
        confidence: null,
        signals: null,
        reasoning: claim.reasoning,
        llmCallId: unit.callLogId,
      });
    }
  }

  return results;
}
