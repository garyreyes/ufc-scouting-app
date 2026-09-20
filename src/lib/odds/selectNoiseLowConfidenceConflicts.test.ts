import { describe, expect, it } from "vitest";
import { selectNoiseLowConfidenceConflictIds } from "./selectNoiseLowConfidenceConflicts";

// P5 (ROADMAP_V2.md Phase P): before MIN_REVIEW_THRESHOLD existed (P2),
// decideMatch filed a low_confidence_odds_match for ANY score below
// AUTO_MATCH_THRESHOLD, including pure noise (0.231 and below, live
// 2026-09-20). P2 stops new noise rows from being filed; this selects the
// pre-existing ones the new floor would never have filed, so a one-time
// cleanup can close them. Threshold is a parameter, not the imported
// constant, so this stays testable independent of MIN_REVIEW_THRESHOLD's
// live value.
describe("selectNoiseLowConfidenceConflictIds", () => {
  it("selects an open row whose confidence is below the floor", () => {
    const ids = selectNoiseLowConfidenceConflictIds(
      [{ id: "conflict-1", details: { confidence: 0.231 }, resolved_at: null }],
      0.5,
    );
    expect(ids).toEqual(["conflict-1"]);
  });

  it("leaves a row alone when its confidence is at or above the floor", () => {
    const ids = selectNoiseLowConfidenceConflictIds(
      [{ id: "conflict-1", details: { confidence: 0.5 }, resolved_at: null }],
      0.5,
    );
    expect(ids).toEqual([]);
  });

  it("leaves an already-resolved row alone even if its confidence is noise", () => {
    const ids = selectNoiseLowConfidenceConflictIds(
      [{ id: "conflict-1", details: { confidence: 0.1 }, resolved_at: "2026-09-20T00:00:00Z" }],
      0.5,
    );
    expect(ids).toEqual([]);
  });

  it("selects only the noise rows out of a mixed batch", () => {
    const ids = selectNoiseLowConfidenceConflictIds(
      [
        { id: "noise", details: { confidence: 0.1 }, resolved_at: null },
        { id: "genuine", details: { confidence: 0.816 }, resolved_at: null },
      ],
      0.5,
    );
    expect(ids).toEqual(["noise"]);
  });

  it("returns an empty array when nothing is below the floor", () => {
    const ids = selectNoiseLowConfidenceConflictIds(
      [{ id: "conflict-1", details: { confidence: 0.9 }, resolved_at: null }],
      0.5,
    );
    expect(ids).toEqual([]);
  });
});
