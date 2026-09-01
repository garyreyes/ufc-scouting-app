// The full application-level shape of one picks row, minus the columns
// the caller always knows from context (fight_id, author, user_id) --
// shared by the read path (features/picks/api.ts), the merge helper
// (mergePickFields.ts), and both save actions, so there is exactly one
// definition of "what a pick is" rather than QuickPick's and BetRow's own
// partial shapes drifting apart. Matches 0019_picks.sql's not-null/
// nullable split exactly: predictedFighterId/estimatedProbability/
// confidence are always set; predictedMethod/reasoning/betFighterId/
// stakeUnits are optional layers on top.
export interface PickFields {
  predictedFighterId: string;
  estimatedProbability: number;
  confidence: number;
  predictedMethod: string | null;
  reasoning: string | null;
  betFighterId: string | null;
  stakeUnits: number | null;
}

// The owner's own USER pick for one fight, as read back for the card view
// -- PickFields plus which fight it belongs to. Supersedes C3's
// MyQuickPick: the collapsed row only ever read predictedFighterId off
// it, so widening the shape to the full row (for BetRow's prefill) is a
// safe superset, not a breaking change to QuickPick.
export interface MyPick extends PickFields {
  fightId: string;
}
