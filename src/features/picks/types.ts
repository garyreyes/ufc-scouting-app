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

// The intern's own pick, as read back for the card view (docs/user-flows.md
// Flow 1: the collapsed bout row shows "odds, rumour flags, intern's
// pick" -- built alongside the calibration check since both read the
// same author="INTERN" picks rows). Still a narrower slice than MyPick:
// predicted_method belongs to a closer look, not to a collapsed row.
//
// **reasoning was added in I5**, reversing this type's original call to
// leave it out. A confidence of 1/5 with nothing to explain it is a
// number the reader has to take on faith; the sentence underneath is the
// only thing that makes the pick auditable, and auditing the intern
// against yourself is the entire point of the scoreboard. Nullable
// because 0019_picks.sql allows it -- an owner's hand-written pick may
// carry none, and this same column is shared by both authors.
//
// **bet fields added alongside**: a pick ("who wins", free) and a bet
// (edge-gated, real units, the intern is free to decline) are two
// different judgments -- UC-2 -- and the card view was showing only the
// first. betFighterId is null on the ~90% of picks the intern does not
// bet; non-null means it staked stakeUnits on that fighter.
export interface InternPickSummary {
  fightId: string;
  predictedFighterId: string;
  estimatedProbability: number;
  confidence: number;
  reasoning: string | null;
  betFighterId: string | null;
  stakeUnits: number | null;
}
