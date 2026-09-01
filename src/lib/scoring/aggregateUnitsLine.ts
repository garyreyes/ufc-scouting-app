export interface BetResult {
  stakeUnits: number;
  pnlUnits: number;
}

export interface UnitsLine {
  netUnits: number;
  betsPlaced: number;
  betsWon: number;
  betsLost: number;
  betsVoided: number;
}

// Shared by all three units-board lines (me, intern, chalk) -- each
// ultimately reduces to a list of individual bet results, whether they
// come from real picks rows or chalk's synthetic 1-unit-on-the-favourite
// bets (features/scoreboard/api.ts). A void bet (pnlUnits === 0, distinct
// from no bet at all, which never becomes a BetResult in the first
// place) counts toward betsPlaced but neither won nor lost.
export function aggregateUnitsLine(results: BetResult[]): UnitsLine {
  let netUnits = 0;
  let betsWon = 0;
  let betsLost = 0;
  let betsVoided = 0;

  for (const result of results) {
    netUnits += result.pnlUnits;
    if (result.pnlUnits > 0) betsWon++;
    else if (result.pnlUnits < 0) betsLost++;
    else betsVoided++;
  }

  return { netUnits, betsPlaced: results.length, betsWon, betsLost, betsVoided };
}
