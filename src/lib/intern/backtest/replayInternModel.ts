import { devigTwoWay } from "../../scoring/devigTwoWay";
import { scoreBetPnl } from "../../scoring/scoreBetPnl";
import { confidenceFor } from "../decideInternPick";
import { decideInternBetV2 } from "../decideInternBetV2";
import { applyInternDelta, type InternModelParams } from "../internModel";

// Phase S1: replays the Intern over fights it already priced, holding the
// signals fixed and varying only how much of them is trusted and how bets
// are gated. The one input that can't be re-derived cheaply -- the signal
// delta itself (Elo as of that day, rumours as of that day) -- is recovered
// from what the Intern actually stored, so the replay isolates exactly the
// thing Phase S changes.

export interface BacktestFight {
  fightId: string;
  fighter1Id: string;
  fighter2Id: string;
  fighter1Price: number;
  fighter2Price: number;
  // Signed toward fighter1, already MAX_TOTAL_ADJUSTMENT-clamped.
  v1Delta: number;
  minRatedFightCount: number;
  // null = void (draw / no contest).
  winnerId: string | null;
}

export interface ReplayMetrics {
  fights: number;
  brier: number;
  logLoss: number;
  correct: number;
  bets: number;
  betsWon: number;
  staked: number;
  pnl: number;
  roi: number | null;
  dogBets: number;
  dogPnl: number;
}

/**
 * The v1 delta a stored pick implies. Prefer signals.clampedDelta (exact);
 * otherwise invert the stored probability against the same de-vigged
 * anchor. Correct for floor-flipped picks too, since a flip stores 1 - p
 * on the other fighter. A v1 read clamped at 0.01/0.99 recovers only a
 * lower bound on the magnitude -- which understates v1's own error, never
 * v2's.
 */
export function recoverV1Delta(
  storedSignalsDelta: number | null,
  storedProbability: number,
  predictedIsFighter1: boolean,
  fighter1Price: number,
  fighter2Price: number,
): number {
  if (storedSignalsDelta !== null) return storedSignalsDelta;
  const anchor1 = devigTwoWay(fighter1Price, fighter2Price).prob1;
  const p1 = predictedIsFighter1 ? storedProbability : 1 - storedProbability;
  return p1 - anchor1;
}

// Parses decideInternPick's own Elo note: "Elo: A 1500 (10 rated), B 1480 (3 rated)."
export function minRatedFromReasoning(reasoning: string | null): number {
  const counts = [...(reasoning ?? "").matchAll(/\((\d+) rated\)/g)].map((m) => Number(m[1]));
  return counts.length >= 2 ? Math.min(counts[0], counts[1]) : 0;
}

const LOG_FLOOR = 1e-6;

export function replayInternModel(fights: BacktestFight[], model: InternModelParams): ReplayMetrics {
  let brierSum = 0;
  let logLossSum = 0;
  let scored = 0;
  let correct = 0;
  let bets = 0;
  let betsWon = 0;
  let staked = 0;
  let pnl = 0;
  let dogBets = 0;
  let dogPnl = 0;

  for (const f of fights) {
    const anchor1 = devigTwoWay(f.fighter1Price, f.fighter2Price).prob1;
    const p1 = applyInternDelta(anchor1, f.v1Delta, model);
    const predictedId = p1 >= 0.5 ? f.fighter1Id : f.fighter2Id;
    const pPick = p1 >= 0.5 ? p1 : 1 - p1;
    const confidence = confidenceFor(pPick, f.minRatedFightCount);

    if (f.winnerId !== null) {
      const won1 = f.winnerId === f.fighter1Id ? 1 : 0;
      brierSum += (won1 - p1) ** 2;
      logLossSum += -Math.log(Math.max(LOG_FLOOR, won1 ? p1 : 1 - p1));
      scored++;
      if (predictedId === f.winnerId) correct++;
    }

    const bet = decideInternBetV2(f.fighter1Id, f.fighter2Id, predictedId, pPick, confidence, {
      fighter1Price: f.fighter1Price,
      fighter2Price: f.fighter2Price,
    });
    if (bet.betFighterId === null || bet.stakeUnits === null) continue;

    const price = bet.betFighterId === f.fighter1Id ? f.fighter1Price : f.fighter2Price;
    const outcome = f.winnerId === null ? { kind: "void" as const } : { kind: "decided" as const, winnerId: f.winnerId };
    const betPnl = scoreBetPnl(bet.betFighterId, bet.stakeUnits, price, outcome) ?? 0;
    bets++;
    staked += bet.stakeUnits;
    pnl += betPnl;
    if (betPnl > 0) betsWon++;
    if (price >= 2) {
      dogBets++;
      dogPnl += betPnl;
    }
  }

  return {
    fights: scored,
    brier: scored ? brierSum / scored : 0,
    logLoss: scored ? logLossSum / scored : 0,
    correct,
    bets,
    betsWon,
    staked,
    pnl,
    roi: staked > 0 ? pnl / staked : null,
    dogBets,
    dogPnl,
  };
}
