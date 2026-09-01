// What the market itself thinks a fighter's win probability is, from the
// frozen T-12h snapshot price. Deliberately never stored (ARCHITECTURE.md
// Entities: "storing both invites them to disagree") -- always derived
// live from odds_snapshots at read time. No American-odds conversion
// anywhere in this codebase; decimalOdds is exactly what the API and the
// odds_snapshots table store.
export function impliedProbability(decimalOdds: number): number {
  return 1 / decimalOdds;
}
