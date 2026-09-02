// Standard Elo -- the same math chess ratings and FiveThirtyEight's own
// sports models use. Correctness-critical (ARCHITECTURE.md's test-first
// list): this feeds decideInternPick.ts's probability, which G2 will
// eventually multiply against a price to size real bets, so a wrong
// direction here isn't a wrong number, it's a silently wrong strategy --
// the same reasoning already applied to lib/scoring/edge.ts.

export const DEFAULT_RATING = 1500;

// Provisional K-factor, higher for fighters with few prior UFC fights so
// their rating converges toward their true level quickly instead of
// moving in tiny, meaningless steps while the sample is still mostly
// noise -- the same "provisional rating" idea USCF/FIDE chess ratings
// use. Settles to the standard K=32 once a fighter has a real sample.
export function kFactorForPriorFightCount(priorFightCount: number): number {
  if (priorFightCount < 5) return 64;
  if (priorFightCount < 10) return 48;
  return 32;
}

/**
 * The standard logistic expected-score formula: the probability rating A
 * "should" win against rating B, purely from the ratings gap. Symmetric
 * by construction -- expectedScore(a, b) + expectedScore(b, a) === 1.
 */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

/**
 * One fight's rating update for both fighters. actualScoreA is 1 (A
 * won), 0 (A lost), or 0.5 (draw) -- actualScoreB is always its
 * complement, so this is always zero-sum FOR A GIVEN SHARED K, but the
 * two fighters can have different K-factors (a debuting fighter facing a
 * veteran), which is the normal, accepted Elo variant this uses, not a
 * bug -- the newer fighter's rating simply moves further per fight than
 * the veteran's does for the same result.
 */
export function updateRatings(
  ratingA: number,
  ratingB: number,
  actualScoreA: 0 | 0.5 | 1,
  kFactorA: number,
  kFactorB: number,
): { ratingA: number; ratingB: number } {
  const expectedA = expectedScore(ratingA, ratingB);
  const expectedB = 1 - expectedA;
  const actualScoreB = 1 - actualScoreA;

  return {
    ratingA: ratingA + kFactorA * (actualScoreA - expectedA),
    ratingB: ratingB + kFactorB * (actualScoreB - expectedB),
  };
}
