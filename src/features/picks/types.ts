import type { FightMethod } from "@/lib/scoring/fightMethod";

// The full application-level shape of one picks row, minus the columns
// the caller always knows from context (fight_id, author, user_id) --
// shared by the read path (features/picks/api.ts), the merge helper
// (mergePickFields.ts), and both save actions, so there is exactly one
// definition of "what a pick is" rather than QuickPick's and BetRow's own
// partial shapes drifting apart. Matches 0019_picks.sql's not-null/
// nullable split exactly: predictedFighterId/estimatedProbability/
// confidence are always set; predictedMethod/reasoning/betFighterId/
// stakeUnits are optional layers on top.
//
// predictedMethod is one of three fixed values (0035) or null; the form
// only emits those, and upsertPick re-checks before writing.
export interface PickFields {
  predictedFighterId: string;
  estimatedProbability: number;
  confidence: number;
  predictedMethod: FightMethod | null;
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
// same author="INTERN" picks rows).
//
// This started as a narrow slice, and has widened deliberately with each
// thing the card view turned out to actually need: **reasoning** (I5 --
// a bare confidence number is not auditable, and auditing the intern
// against yourself is the whole point of the scoreboard), **bet fields**
// (a pick and a bet are two different calls -- UC-2 -- and the row was
// showing only the first), and **predictedMethod** (the intern now
// predicts how a fight ends too -- predictInternMethod.ts). betFighterId
// is null on the ~90% of picks the intern does not bet.
export interface InternPickSummary {
  fightId: string;
  predictedFighterId: string;
  estimatedProbability: number;
  confidence: number;
  reasoning: string | null;
  predictedMethod: FightMethod | null;
  betFighterId: string | null;
  stakeUnits: number | null;
}
