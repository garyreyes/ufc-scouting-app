import { DEFAULT_RATING, kFactorForPriorFightCount, updateRatings } from "./eloMath";
// Shared with lib/records/deriveFighterRecords.ts (I5) -- a fighter's
// rating and their W-L-D must never disagree about what a given fight
// was. See that module for why this is one file, not two copies.
import { isNoContestOrAmbiguous } from "./isNoContestOrAmbiguous";

export interface FightForElo {
  fightId: string;
  fighter1Id: string;
  fighter2Id: string;
  // null means void -- a draw or a No Contest, indistinguishable by this
  // column alone (fights.winner_id, same convention
  // lib/scoring/fightOutcomeFromSettledFight.ts already uses for pick
  // scoring). method is what disambiguates them here.
  winnerId: string | null;
  method: string | null;
  // When the fight actually HAPPENED (its event's date), not when this
  // app got around to settling it. Elo is sequential, so the ordering
  // key has to be real chronology: settlement order is not chronological
  // order -- a disputed bout can settle days after later fights already
  // did, which is the very reason recomputeEloRatings does a full
  // rebuild rather than an incremental patch. Ordering by settlement
  // time would have rated those fights in the wrong sequence (I1).
  occurredAt: string;
}

export interface EloSnapshot {
  fighterId: string;
  fightId: string;
  rating: number;
  fightOccurredAt: string;
}

/**
 * Rebuilds the ENTIRE Elo history from every settled UFC fight, in
 * chronological order -- Elo is inherently sequential, so this is always
 * a full recompute, never an incremental patch (0029_fighter_elo_
 * history.sql's own comment explains why: a correction to an old result
 * must be able to ripple forward through every rating computed since).
 * Pure and I/O-free by design, same convention as lib/scoring/ and
 * lib/settlement/evaluateFightSettlement.ts -- recomputeEloRatings.ts
 * owns fetching the real data and writing the result.
 *
 * A debuting fighter is never given an explicit seed row -- they simply
 * have no rows yet, and DEFAULT_RATING is applied at read time (here,
 * and by any caller resolving "this fighter's rating right now" with no
 * history to look up).
 */
export function computeEloHistory(fights: FightForElo[]): EloSnapshot[] {
  const sorted = [...fights].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
  );

  const currentRating = new Map<string, number>();
  const priorFightCount = new Map<string, number>();
  const snapshots: EloSnapshot[] = [];

  for (const fight of sorted) {
    const { fighter1Id, fighter2Id, winnerId, method } = fight;

    // A self-fight -- both sides the same fighter row, an upsertFighter
    // name-fold artifact (the I4b class of duplicate) -- is not a fight
    // to rate at all. Left unguarded, updateRatings would return two
    // DIFFERENT ratings for one fighter/fight pair and push both into
    // snapshots; fighter_elo_history's own unique(fighter_id, fight_id)
    // constraint (0029) then rejects the second insert, and by that
    // point recomputeEloRatings has already deleted the whole table --
    // one bad row would wipe every rating. Shared with
    // deriveFighterRecords.ts, which guards the same case for the same
    // reason.
    if (fighter1Id === fighter2Id) continue;

    if (winnerId === null && isNoContestOrAmbiguous(method)) {
      continue;
    }

    // Defensive: winner_id set but matching neither of this fight's own
    // two fighters is a data-integrity problem, not a fight to guess an
    // outcome for.
    if (winnerId !== null && winnerId !== fighter1Id && winnerId !== fighter2Id) {
      continue;
    }

    const rating1 = currentRating.get(fighter1Id) ?? DEFAULT_RATING;
    const rating2 = currentRating.get(fighter2Id) ?? DEFAULT_RATING;
    const k1 = kFactorForPriorFightCount(priorFightCount.get(fighter1Id) ?? 0);
    const k2 = kFactorForPriorFightCount(priorFightCount.get(fighter2Id) ?? 0);

    const actualScore1: 0 | 0.5 | 1 =
      winnerId === null ? 0.5 : winnerId === fighter1Id ? 1 : 0;

    const { ratingA: newRating1, ratingB: newRating2 } = updateRatings(
      rating1,
      rating2,
      actualScore1,
      k1,
      k2,
    );

    currentRating.set(fighter1Id, newRating1);
    currentRating.set(fighter2Id, newRating2);
    priorFightCount.set(fighter1Id, (priorFightCount.get(fighter1Id) ?? 0) + 1);
    priorFightCount.set(fighter2Id, (priorFightCount.get(fighter2Id) ?? 0) + 1);

    snapshots.push({
      fighterId: fighter1Id,
      fightId: fight.fightId,
      rating: newRating1,
      fightOccurredAt: fight.occurredAt,
    });
    snapshots.push({
      fighterId: fighter2Id,
      fightId: fight.fightId,
      rating: newRating2,
      fightOccurredAt: fight.occurredAt,
    });
  }

  return snapshots;
}
