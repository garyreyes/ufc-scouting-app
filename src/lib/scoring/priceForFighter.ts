// Resolves which side of a CardBout's odds belongs to a given fighter --
// a plain lookup, but the wrong side silently flips the sign of a live
// edge display (item #2's dependency chain), so it gets the same
// pure-function-plus-test treatment as the formulas themselves.
export function priceForFighter(
  fighterId: string,
  fighter1Id: string,
  fighter2Id: string,
  odds: { fighter1_price: number; fighter2_price: number } | null,
): number | null {
  if (odds === null) return null;
  if (fighterId === fighter1Id) return odds.fighter1_price;
  if (fighterId === fighter2Id) return odds.fighter2_price;
  return null;
}
