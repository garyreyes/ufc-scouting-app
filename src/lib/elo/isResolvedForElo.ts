/**
 * Whether a fight row carries a real, recorded outcome -- and so belongs
 * in the Elo rebuild.
 *
 * **This replaces `settled_at IS NOT NULL`, and the distinction is the
 * whole point of I1.** `settled_at` records that THIS APP's settlement
 * pipeline (D1/D2) processed the fight, which is a much narrower thing
 * than "the fight happened and we know who won." Production had 57
 * fights with a recorded winner and zero settled fights, so Elo was
 * rebuilding from an empty set while real results sat one column over.
 * Backfilled history (I3) has the same shape: a known result that never
 * passed through a settlement job, because there was nothing live to
 * settle.
 *
 * A null method with a winner is fine -- the api_sports_only_24h
 * settlement path writes exactly that shape, and a decisive result needs
 * no method to be scored. A null method with a NULL winner is the case
 * that cannot be interpreted at all, and is the only one excluded here.
 *
 * Note this deliberately lets a No Contest through: computeEloHistory
 * owns the rule that an NC must never move a rating, and duplicating
 * that judgment here would put it in two places that could drift.
 */
export function isResolvedForElo(fight: { winnerId: string | null; method: string | null }): boolean {
  return fight.winnerId !== null || fight.method !== null;
}
