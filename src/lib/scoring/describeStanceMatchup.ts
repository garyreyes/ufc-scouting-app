// The scoreboard's stance/style breakdown (E2). Canonicalized by sorting
// so "Orthodox vs Southpaw" and "Southpaw vs Orthodox" are always the
// same bucket, regardless of which fighter happens to be fighter1 --
// that's an accident of sync order, not a real distinction. Either
// fighter missing a synced stance (a Wikipedia-only placeholder fighter
// API-Sports hasn't caught up to yet -- see upsertFighter.ts) means the
// matchup can't be classified at all.
export function describeStanceMatchup(stance1: string | null, stance2: string | null): string {
  if (stance1 === null || stance2 === null) return "Unknown";
  return [stance1, stance2].sort().join(" vs ");
}
