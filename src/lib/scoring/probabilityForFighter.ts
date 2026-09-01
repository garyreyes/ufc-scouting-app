// A picks row stores exactly one estimated_probability, always meaning
// P(predicted_fighter_id wins) -- see 0019_picks.sql and docs/PRD.md UC-2.
// A bet may back a *different* fighter than the pick, so live edge for
// that bet needs P(bet_fighter wins), not the stored number verbatim.
export function probabilityForFighter(
  fighterId: string,
  predictedFighterId: string,
  estimatedProbability: number,
): number {
  return fighterId === predictedFighterId ? estimatedProbability : 1 - estimatedProbability;
}
