import { determineFavorite } from "../scoring/determineFavorite";
import { devigTwoWay } from "../scoring/devigTwoWay";
import { probabilityForFighter } from "../scoring/probabilityForFighter";

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
  // Passed through untouched -- the bet floor was removed in Phase S2.
  bet: { betFighterId: string | null; stakeUnits: number | null };
}

interface PricedCandidate {
  input: FloorInput;
  underdogId: string;
  // The Intern's own probability for the underdog minus the de-vigged
  // market's, in probability points.
  underdogEdge: number;
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
    const market = devigTwoWay(f.odds.fighter1Price, f.odds.fighter2Price);
    const marketDog = underdogId === f.fighter1Id ? market.prob1 : market.prob2;
    const modelDog = probabilityForFighter(underdogId, f.pick.predictedFighterId, f.pick.estimatedProbability);
    candidates.push({ input: f, underdogId, underdogEdge: modelDog - marketDog });
  }
  return candidates;
}

// Owner-decided 2026-09-28: the underdog the Intern rates furthest above
// the market wins -- probability points, not EV, since EV scales with the
// price and would drift straight back to the biggest longshot. It used to
// be the biggest price, which is usually the dog the Intern rates WORST.
// Ties break toward the lower fightId, matching decideInternPick.ts's own
// deterministic tie-break convention.
function mostEdgeUnderdog(candidates: PricedCandidate[]): PricedCandidate {
  return candidates.reduce((best, c) => {
    if (c.underdogEdge > best.underdogEdge) return c;
    if (c.underdogEdge === best.underdogEdge && c.input.fightId < best.input.fightId) return c;
    return best;
  });
}

/**
 * The card-level floor: after decideInternPick/decideInternBet have
 * already formed their honest, per-fight opinions, guarantee at least one
 * underdog pick in the main card and one in the prelims (real UFC cards
 * almost never sweep every favourite -- user-confirmed 2026-09-21).
 *
 * Phase S2 removed the matching bet floor: it moved a stake sized from the
 * favourite's edge onto the underdog with no edge check. Bets now pass
 * through untouched; underdog value lives in the value-bet slips.
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
        bet: { ...f.bet },
      },
    ]),
  );

  for (const segment of ["main", "prelims"] as const) {
    const segmentFights = fights.filter((f) => f.segment === segment);
    applyPickFloor(segmentFights, results);
  }

  return fights.map((f) => results.get(f.fightId)!);
}

function applyPickFloor(segmentFights: FloorInput[], results: Map<string, FloorResult>): void {
  const candidates = pricedCandidatesFor(segmentFights);
  if (candidates.length === 0) return;

  const hasUnderdogPick = candidates.some((c) => c.input.pick.predictedFighterId === c.underdogId);
  if (hasUnderdogPick) return;

  const flip = mostEdgeUnderdog(candidates);
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
