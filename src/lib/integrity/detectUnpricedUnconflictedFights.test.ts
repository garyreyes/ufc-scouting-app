import { describe, expect, it } from "vitest";
import { detectUnpricedUnconflictedFights } from "./detectUnpricedUnconflictedFights";
import type { FightForMatching } from "../odds/types";

// I3 (ROADMAP_V2.md Phase P, Tier 3): the exact shape of the Pitbull/Choi
// stuck-fight incident, generalized -- a fight past its T-12h window with
// no price AND nothing already tracking why. `fetchEligibleUnpricedFights`
// already gives "unpriced AND past the window"; this function adds the
// "AND nothing already conflicted about it" half.

function fight(id: string): FightForMatching {
  return { id, eventDate: "2026-09-19", fighter1Name: "A", fighter2Name: "B" };
}

describe("detectUnpricedUnconflictedFights", () => {
  it("flags an eligible fight with no conflict tracking it at all", () => {
    const flagged = detectUnpricedUnconflictedFights([fight("f1")], new Set(), new Set());
    expect(flagged).toEqual(["f1"]);
  });

  it("does not flag a fight already held by an open disputed_opponent conflict", () => {
    const flagged = detectUnpricedUnconflictedFights([fight("f1")], new Set(["f1"]), new Set());
    expect(flagged).toEqual([]);
  });

  it("does not flag a fight already guessed at by an open low_confidence_odds_match", () => {
    const flagged = detectUnpricedUnconflictedFights([fight("f1")], new Set(), new Set(["f1"]));
    expect(flagged).toEqual([]);
  });

  it("flags only the genuinely uncovered fight among several", () => {
    const flagged = detectUnpricedUnconflictedFights(
      [fight("f1"), fight("f2"), fight("f3")],
      new Set(["f1"]),
      new Set(["f2"]),
    );
    expect(flagged).toEqual(["f3"]);
  });
});
