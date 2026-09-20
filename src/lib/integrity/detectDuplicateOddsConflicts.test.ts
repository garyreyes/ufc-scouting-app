import { describe, expect, it } from "vitest";
import { detectDuplicateOddsConflicts } from "./detectDuplicateOddsConflicts";

// I6 (ROADMAP_V2.md Phase P, Tier 3): two open low_confidence_odds_match
// rows pointing at the same candidate fight is exactly the class D4 was
// meant to prevent at write time (a re-emitted feed id) -- this is the
// safety net in case a row still slips through. Auto-remediated, not an
// alert: closing the newer duplicate is mechanical, no owner judgment
// needed.

describe("detectDuplicateOddsConflicts", () => {
  it("closes every row but the earliest in a group sharing a candidate fight", () => {
    const toClose = detectDuplicateOddsConflicts([
      { id: "c1", candidateFightId: "f1", detectedAt: "2026-09-18T00:00:00Z" },
      { id: "c2", candidateFightId: "f1", detectedAt: "2026-09-19T00:00:00Z" },
      { id: "c3", candidateFightId: "f1", detectedAt: "2026-09-20T00:00:00Z" },
    ]);
    expect(toClose.sort()).toEqual(["c2", "c3"]);
  });

  it("closes nothing when every candidate fight is a singleton", () => {
    const toClose = detectDuplicateOddsConflicts([
      { id: "c1", candidateFightId: "f1", detectedAt: "2026-09-18T00:00:00Z" },
      { id: "c2", candidateFightId: "f2", detectedAt: "2026-09-19T00:00:00Z" },
    ]);
    expect(toClose).toEqual([]);
  });

  it("never groups null candidateFightId rows together", () => {
    const toClose = detectDuplicateOddsConflicts([
      { id: "c1", candidateFightId: null, detectedAt: "2026-09-18T00:00:00Z" },
      { id: "c2", candidateFightId: null, detectedAt: "2026-09-19T00:00:00Z" },
    ]);
    expect(toClose).toEqual([]);
  });
});
