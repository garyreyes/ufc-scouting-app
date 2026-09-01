export interface Favorite {
  favoriteId: string;
  favoritePrice: number;
}

// Lower decimal odds = higher implied probability = the market's
// favourite. Used only by the scoreboard's chalk line (E1) -- picks/bets
// themselves never need this, since a real bettor chooses their own side.
// An exact tie (a genuine pick'em, decimal odds equal to several decimal
// places) is rare enough in practice that a deterministic tie-break
// toward fighter1 doesn't meaningfully distort the chalk baseline.
export function determineFavorite(
  fighter1Id: string,
  fighter2Id: string,
  odds: { fighter1_price: number; fighter2_price: number },
): Favorite {
  if (odds.fighter2_price < odds.fighter1_price) {
    return { favoriteId: fighter2Id, favoritePrice: odds.fighter2_price };
  }
  return { favoriteId: fighter1Id, favoritePrice: odds.fighter1_price };
}
