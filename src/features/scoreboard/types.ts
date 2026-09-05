import type { UnitsLine } from "@/lib/scoring/aggregateUnitsLine";
import type { AccuracyLine } from "@/lib/scoring/aggregateAccuracyLine";
import type { CalibrationBucket } from "@/lib/scoring/computeCalibrationBuckets";
import type { PendingSummary, PendingSide } from "@/lib/scoring/summarizePendingPicks";

export type { UnitsLine, AccuracyLine, CalibrationBucket, PendingSummary, PendingSide };

// The intern's accuracy carries two numbers, not one (docs/PRD.md UC-4):
// head-to-head on fights both the owner and the intern picked is the
// headline comparison ("only fights we both picked are like-for-like"),
// full-card is secondary context shown alongside it. Built now even
// though Phase G (the intern) doesn't exist yet -- both numbers are
// trivially "no data" until then, but the shape matches the PRD's actual
// spec rather than needing a later rework once real intern picks exist.
export interface InternAccuracyLine extends AccuracyLine {
  headToHead: AccuracyLine;
}

// E2's own row shape: pick history lives on /scoreboard as a filterable
// table under the two boards, not its own route (docs/user-flows.md).
// USER picks only -- "pick history" reads naturally as the owner's own
// log, and the intern has no rows to show yet regardless (Phase G).
export interface PickTableRow {
  pickId: string;
  fightId: string;
  eventName: string;
  eventDate: string;
  fighter1Name: string;
  fighter2Name: string;
  weightClass: string | null;
  predictedFighterName: string;
  pickCorrect: boolean | null; // null = void (no correct answer to score)
  betFighterName: string | null; // null = no bet placed
  stakeUnits: number | null;
  pnlUnits: number | null;
  // null when the fight was never priced -- can't tell favourite from
  // underdog without a market to read.
  favoriteOrUnderdog: "favorite" | "underdog" | null;
  stanceMatchup: string; // "Unknown" when either fighter's stance is unsynced
  // Always false until Phase F (the rumour engine) ships -- not omitted,
  // so the filter control can exist now and simply say so, rather than
  // needing to be added to this shape later.
  flagPresent: boolean;
}

export interface ScoreboardData {
  units: {
    me: UnitsLine;
    intern: UnitsLine;
    chalk: UnitsLine;
  };
  accuracy: {
    me: AccuracyLine;
    intern: InternAccuracyLine;
    chalk: AccuracyLine;
  };
  // Distinct events with at least one settled fight -- the PRD's own
  // "10-card window" framing for when the boards stop being a small
  // sample (docs/user-flows.md: "the PRD's target is 10 cards").
  settledCardCount: number;
  // Settled picks whose fight was never priced (a missed T-12h snapshot
  // -- B5's own banner already flags this loudly elsewhere, so this
  // should be rare). Counted in accuracy, excluded from units, and said
  // so on screen (docs/user-flows.md).
  unpricedSettledPickCount: number;
  // Picks and bets riding on fights that haven't settled yet, per side.
  // Shown above the boards so the page is informative before the first
  // card of a window scores -- the boards themselves stay strictly about
  // settled, scored results.
  pending: PendingSummary;
  pickHistory: PickTableRow[];
  // G3's calibration check (ROADMAP.md): "of the fights called 70%, did
  // roughly 70% happen?" -- one set of bands per line, "me" and "intern"
  // (not chalk, which has no independent probability estimate of its
  // own to check -- it just always backs the favourite). Uses each
  // line's FULL settled population, not the intern's head-to-head
  // restriction accuracy uses -- calibration asks whether a stated
  // number meant what it said, which every one of that line's own
  // estimates can answer, not just the ones that happen to overlap with
  // the other line's picks.
  calibration: {
    me: CalibrationBucket[];
    intern: CalibrationBucket[];
  };
}
