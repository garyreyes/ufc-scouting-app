export interface RoiResult {
  stakePhp: number;
  pnlPhp: number;
  stakeUnits: number;
  pnlUnits: number;
}

export interface RoiLine {
  stakedPhp: number;
  netPhp: number;
  netUnits: number;
  // null when stakedPhp is 0 -- "no ROI" is a different fact than "0% ROI"
  // and the caller (ArchetypeRoiBoard) needs to tell them apart rather
  // than print a misleading 0.0%.
  roiPct: number | null;
  betsPlaced: number;
  betsWon: number;
  betsLost: number;
  betsVoided: number;
}

// Q5's per-archetype rollup -- same reduce shape as aggregateUnitsLine, but
// over slip-level PHP results (bet_slips.pnl_php/pnl_units, both generated
// columns) rather than picks, and with an ROI% the picks-based board never
// needed (picks has no stake_php at all).
export function aggregateRoiLine(results: RoiResult[]): RoiLine {
  let stakedPhp = 0;
  let netPhp = 0;
  let netUnits = 0;
  let betsWon = 0;
  let betsLost = 0;
  let betsVoided = 0;

  for (const result of results) {
    stakedPhp += result.stakePhp;
    netPhp += result.pnlPhp;
    netUnits += result.pnlUnits;
    if (result.pnlPhp > 0) betsWon++;
    else if (result.pnlPhp < 0) betsLost++;
    else betsVoided++;
  }

  return {
    stakedPhp,
    netPhp,
    netUnits,
    roiPct: stakedPhp > 0 ? (netPhp / stakedPhp) * 100 : null,
    betsPlaced: results.length,
    betsWon,
    betsLost,
    betsVoided,
  };
}
