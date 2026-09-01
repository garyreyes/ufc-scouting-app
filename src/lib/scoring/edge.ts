// What decides whether a bet is worth making at all (docs/PRD.md UC-3):
// the intern bets only above a threshold and sizes by edge, which is what
// stops it dumping units on unbackable favourites. An error here doesn't
// produce a wrong number, it produces a silently wrong *strategy*
// (ARCHITECTURE.md item #2) -- every downstream betting decision reads
// this value, not just displays it.
export function edge(estimatedProbability: number, decimalOdds: number): number {
  return estimatedProbability * decimalOdds - 1;
}
