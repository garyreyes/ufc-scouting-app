import { decideInternBet } from "../intern/decideInternBet";
import { aggregateAccuracyLine } from "../scoring/aggregateAccuracyLine";
import type { AccuracyLine } from "../scoring/aggregateAccuracyLine";
import { aggregateUnitsLine } from "../scoring/aggregateUnitsLine";
import type { BetResult, UnitsLine } from "../scoring/aggregateUnitsLine";
import { computeBrierScore } from "../scoring/computeBrierScore";
import type { BrierScoreResult } from "../scoring/computeBrierScore";
import { priceForFighter } from "../scoring/priceForFighter";
import { scoreBetPnl } from "../scoring/scoreBetPnl";
import { scorePickCorrect } from "../scoring/scorePickCorrect";
import type { FightOutcome } from "../scoring/types";

export interface ShadowScoredFight {
  fighter1Id: string;
  fighter2Id: string;
  outcome: FightOutcome;
  // null when the fight was never priced -- same "no bet without a real
  // price" rule settlePicks.ts already enforces for real picks.
  odds: { fighter1_price: number; fighter2_price: number } | null;
}

export interface ScoredShadowRow {
  fightId: string;
  line: "LLM_ASSISTED" | "LLM_ONLY";
  predictedFighterId: string;
  probability: number;
  confidence: number | null;
}

export interface ShadowLineScore {
  accuracy: AccuracyLine;
  brier: BrierScoreResult;
  // null for LLM_ONLY -- N9 scope, confirmed 2026-09-19: it has no
  // confidence, so decideInternBet can't structurally run for it.
  units: UnitsLine | null;
}

/**
 * N9's second correctness-critical function (after
 * `selectLatestBeforeLock.ts`) -- scores whichever rows the caller has
 * already selected as the latest-before-lock per (fightId, line) against
 * their fights' real settled outcomes.
 *
 * LLM_ASSISTED reuses the exact same `decideInternBet`/`scoreBetPnl`/
 * `priceForFighter` functions real INTERN picks settle through (N9 scope,
 * confirmed 2026-09-19: "apples-to-apples with how real intern picks
 * actually settle," not a flat synthetic bet). LLM_ONLY gets no units
 * line at all, not a zeroed one -- it never goes through
 * `decideInternPick`'s own confidence banding, so there is no confidence
 * value for `decideInternBet` to size a stake from.
 */
function scoreLine(
  rows: ScoredShadowRow[],
  fightsById: Map<string, ShadowScoredFight>,
  computeUnits: boolean,
): ShadowLineScore {
  const pickCorrectValues: (boolean | null)[] = [];
  const calibrationEntries: { estimatedProbability: number; correct: boolean | null }[] = [];
  const bets: BetResult[] = [];

  for (const row of rows) {
    const fight = fightsById.get(row.fightId);
    if (!fight) continue;

    const correct = scorePickCorrect(row.predictedFighterId, fight.outcome);
    pickCorrectValues.push(correct);
    calibrationEntries.push({ estimatedProbability: row.probability, correct });

    if (!computeUnits || row.confidence === null || fight.odds === null) continue;

    const bet = decideInternBet(
      fight.fighter1Id,
      fight.fighter2Id,
      row.predictedFighterId,
      row.probability,
      row.confidence,
      { fighter1Price: fight.odds.fighter1_price, fighter2Price: fight.odds.fighter2_price },
    );
    if (bet.betFighterId === null || bet.stakeUnits === null) continue;

    const price = priceForFighter(bet.betFighterId, fight.fighter1Id, fight.fighter2Id, fight.odds);
    if (price === null) continue; // defensive only -- betFighterId is always one of the fight's own two fighters

    const pnlUnits = scoreBetPnl(bet.betFighterId, bet.stakeUnits, price, fight.outcome);
    if (pnlUnits !== null) bets.push({ stakeUnits: bet.stakeUnits, pnlUnits });
  }

  return {
    accuracy: aggregateAccuracyLine(pickCorrectValues),
    brier: computeBrierScore(calibrationEntries),
    units: computeUnits ? aggregateUnitsLine(bets) : null,
  };
}

export function scoreShadowLines(
  rows: ScoredShadowRow[],
  fightsById: Map<string, ShadowScoredFight>,
): { llmAssisted: ShadowLineScore; llmOnly: ShadowLineScore } {
  return {
    llmAssisted: scoreLine(
      rows.filter((r) => r.line === "LLM_ASSISTED"),
      fightsById,
      true,
    ),
    llmOnly: scoreLine(
      rows.filter((r) => r.line === "LLM_ONLY"),
      fightsById,
      false,
    ),
  };
}
