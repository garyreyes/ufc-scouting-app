import type { UnitsLine } from "@/lib/scoring/aggregateUnitsLine";
import type { AccuracyLine } from "@/lib/scoring/aggregateAccuracyLine";

export type { UnitsLine, AccuracyLine };

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
}
