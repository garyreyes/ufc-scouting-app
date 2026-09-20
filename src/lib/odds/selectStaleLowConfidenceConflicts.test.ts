import { describe, expect, it } from "vitest";
import { selectStaleLowConfidenceConflictIds } from "./selectStaleLowConfidenceConflicts";

// D3 (ROADMAP_V2.md Phase P): a low_confidence_odds_match's candidateFightId
// is the algorithm's own best guess at detection time (matchFights.ts). If
// that fight later gets priced -- by a different, more confident odds
// event, or by a manual resolution -- the row is no longer actionable: the
// fight it was guessing about already has a real price. Pure selector,
// matching the buildXResolution convention used elsewhere in
// features/conflicts -- the actual DB read/write stays in matchAndSnapshot.ts.
describe("selectStaleLowConfidenceConflictIds", () => {
  it("selects a conflict whose candidate fight is already priced", () => {
    const ids = selectStaleLowConfidenceConflictIds(
      [{ id: "conflict-1", details: { candidateFightId: "fight-1" } }],
      new Set(["fight-1"]),
    );
    expect(ids).toEqual(["conflict-1"]);
  });

  it("leaves a conflict alone when its candidate fight is still unpriced", () => {
    const ids = selectStaleLowConfidenceConflictIds(
      [{ id: "conflict-1", details: { candidateFightId: "fight-1" } }],
      new Set(["some-other-fight"]),
    );
    expect(ids).toEqual([]);
  });

  it("selects only the stale ones out of a mixed batch", () => {
    const ids = selectStaleLowConfidenceConflictIds(
      [
        { id: "stale", details: { candidateFightId: "priced-fight" } },
        { id: "fresh", details: { candidateFightId: "unpriced-fight" } },
      ],
      new Set(["priced-fight"]),
    );
    expect(ids).toEqual(["stale"]);
  });

  it("returns an empty array when nothing is priced yet", () => {
    const ids = selectStaleLowConfidenceConflictIds(
      [{ id: "conflict-1", details: { candidateFightId: "fight-1" } }],
      new Set(),
    );
    expect(ids).toEqual([]);
  });
});
