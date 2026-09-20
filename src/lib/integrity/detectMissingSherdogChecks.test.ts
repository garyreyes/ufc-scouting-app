import { describe, expect, it } from "vitest";
import { detectMissingSherdogChecks } from "./detectMissingSherdogChecks";

// I2 (ROADMAP_V2.md Phase P, Tier 3): a fighter on an upcoming card should
// never sit unresolved for long -- P7 already chains identity resolution
// into sync.yml so this is normally same-cycle. A daily sweep still
// finding one null is the signal that the chain didn't run (a job
// failure), not the normal in-flight state.

describe("detectMissingSherdogChecks", () => {
  it("flags a card fighter with no sherdog_checked_at", () => {
    const flagged = detectMissingSherdogChecks(
      new Set(["card-fighter-1"]),
      [{ id: "card-fighter-1", sherdogCheckedAt: null }],
    );
    expect(flagged).toEqual(["card-fighter-1"]);
  });

  it("does not flag a card fighter that has been checked (matched or genuinely not on Sherdog)", () => {
    const flagged = detectMissingSherdogChecks(
      new Set(["card-fighter-1"]),
      [{ id: "card-fighter-1", sherdogCheckedAt: "2026-09-19T03:00:00Z" }],
    );
    expect(flagged).toEqual([]);
  });

  it("does not flag a fighter with no check who is NOT on an upcoming card", () => {
    const flagged = detectMissingSherdogChecks(
      new Set(["card-fighter-1"]),
      [{ id: "some-other-fighter", sherdogCheckedAt: null }],
    );
    expect(flagged).toEqual([]);
  });

  it("handles multiple card fighters independently", () => {
    const flagged = detectMissingSherdogChecks(
      new Set(["a", "b"]),
      [
        { id: "a", sherdogCheckedAt: null },
        { id: "b", sherdogCheckedAt: "2026-09-19T03:00:00Z" },
      ],
    );
    expect(flagged).toEqual(["a"]);
  });
});
