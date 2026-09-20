import { describe, expect, it } from "vitest";
import { detectStaleConflicts } from "./detectStaleConflicts";

// I5 (ROADMAP_V2.md Phase P, Tier 3): "a queue nobody drains is as bad as
// no queue" -- an open conflict is a request for a human decision, and one
// sitting open for a week is a process failure the queue can't see about
// itself.

const NOW = new Date("2026-09-20T00:00:00Z");

describe("detectStaleConflicts", () => {
  it("flags a conflict open for 8 days", () => {
    const flagged = detectStaleConflicts([{ id: "c1", detectedAt: "2026-09-12T00:00:00Z" }], NOW);
    expect(flagged).toEqual(["c1"]);
  });

  it("does not flag a conflict open for exactly 7 days (boundary)", () => {
    const flagged = detectStaleConflicts([{ id: "c1", detectedAt: "2026-09-13T00:00:00Z" }], NOW);
    expect(flagged).toEqual([]);
  });

  it("does not flag a conflict opened 1 day ago", () => {
    const flagged = detectStaleConflicts([{ id: "c1", detectedAt: "2026-09-19T00:00:00Z" }], NOW);
    expect(flagged).toEqual([]);
  });

  it("respects a custom maxAgeDays", () => {
    const flagged = detectStaleConflicts([{ id: "c1", detectedAt: "2026-09-19T00:00:00Z" }], NOW, 0.5);
    expect(flagged).toEqual(["c1"]);
  });
});
