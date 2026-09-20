import { determineFavorite } from "../scoring/determineFavorite";

export interface FloorInput {
  fightId: string;
  segment: "main" | "prelims";
  fighter1Id: string;
  fighter2Id: string;
  // null when the fight has no market price yet -- unpriced fights can't
  // be classified favourite/underdog at all, so they're never a flip
  // candidate (same honesty decideInternPick already applies to itself).
  odds: { fighter1Price: number; fighter2Price: number } | null;
  pick: { predictedFighterId: string; estimatedProbability: number; confidence: number };
  bet: { betFighterId: string | null; stakeUnits: number | null };
}

export interface FloorResult {
  fightId: string;
  pick: { predictedFighterId: string; estimatedProbability: number; confidence: number; overridden: boolean };
  bet: { betFighterId: string | null; stakeUnits: number | null; overridden: boolean };
}

interface PricedCandidate {
  input: FloorInput;
  underdogId: string;
  underdogPrice: number;
}

function pricedCandidatesFor(fights: FloorInput[]): PricedCandidate[] {
  const candidates: PricedCandidate[] = [];
  for (const f of fights) {
    if (f.odds === null) continue;
    const favorite = determineFavorite(f.fighter1Id, f.fighter2Id, {
      fighter1_price: f.odds.fighter1Price,
      fighter2_price: f.odds.fighter2Price,
    });
    const underdogId = favorite.favoriteId === f.fighter1Id ? f.fighter2Id : f.fighter1Id;
    const underdogPrice = underdogId === f.fighter1Id ? f.odds.fighter1Price : f.odds.fighter2Price;
    candidates.push({ input: f, underdogId, underdogPrice });
  }
  return candidates;
}

// Highest underdog price wins; ties break toward the lower fightId,
// matching decideInternPick.ts's own deterministic tie-break convention.
function biggestUnderdog(candidates: PricedCandidate[]): PricedCandidate {
  return candidates.reduce((best, c) => {
    if (c.underdogPrice > best.underdogPrice) return c;
    if (c.underdogPrice === best.underdogPrice && c.input.fightId < best.input.fightId) return c;
    return best;
  });
}

/**
 * The card-level floor: after decideInternPick/decideInternBet have
 * already formed their honest, per-fight opinions, guarantee at least one
 * underdog pick in the main card and one in the prelims (real UFC cards
 * almost never sweep every favourite -- user-confirmed 2026-09-21), and
 * separately, at least one underdog BET per segment among the bets
 * INTERN already decided to place.
 *
 * Deliberately never touches decideInternPick/decideInternBet's own
 * output -- this is a distinct, visible override layer, applied here so
 * the model's own reasoning/snapshot stays an honest read of the market.
 * "Favourite"/"underdog" is a market concept (decimal price), not the
 * model's own probability -- reuses determineFavorite.ts, the same
 * definition the scoreboard's chalk line already uses.
 */
export function applyUnderdogFloor(fights: FloorInput[]): FloorResult[] {
  const results = new Map<string, FloorResult>(
    fights.map((f) => [
      f.fightId,
      {
        fightId: f.fightId,
        pick: { ...f.pick, overridden: false },
        bet: { ...f.bet, overridden: false },
      },
    ]),
  );

  for (const segment of ["main", "prelims"] as const) {
    const segmentFights = fights.filter((f) => f.segment === segment);
    applyPickFloor(segmentFights, results);
    applyBetFloor(segmentFights, results);
  }

  return fights.map((f) => results.get(f.fightId)!);
}

function applyPickFloor(segmentFights: FloorInput[], results: Map<string, FloorResult>): void {
  const candidates = pricedCandidatesFor(segmentFights);
  if (candidates.length === 0) return;

  const hasUnderdogPick = candidates.some((c) => c.input.pick.predictedFighterId === c.underdogId);
  if (hasUnderdogPick) return;

  const flip = biggestUnderdog(candidates);
  const flippedProbability = 1 - flip.input.pick.estimatedProbability;
  results.set(flip.input.fightId, {
    fightId: flip.input.fightId,
    pick: {
      predictedFighterId: flip.underdogId,
      estimatedProbability: flippedProbability,
      // Any probability below 0.55 (guaranteed here -- an underdog's own
      // probability is by definition under 0.5) collapses confidenceFor
      // to 1 regardless of rated-fight sample size, so there's no need to
      // thread minRatedFightCount through this layer just to recompute
      // the same constant.
      confidence: 1,
      overridden: true,
    },
    bet: results.get(flip.input.fightId)!.bet,
  });
}

function applyBetFloor(segmentFights: FloorInput[], results: Map<string, FloorResult>): void {
  const betCandidates = pricedCandidatesFor(segmentFights).filter((c) => c.input.bet.betFighterId !== null);
  if (betCandidates.length === 0) return;

  const hasUnderdogBet = betCandidates.some((c) => c.input.bet.betFighterId === c.underdogId);
  if (hasUnderdogBet) return;

  const flip = biggestUnderdog(betCandidates);
  results.set(flip.input.fightId, {
    fightId: flip.input.fightId,
    pick: results.get(flip.input.fightId)!.pick,
    bet: {
      betFighterId: flip.underdogId,
      stakeUnits: flip.input.bet.stakeUnits,
      overridden: true,
    },
  });
}
