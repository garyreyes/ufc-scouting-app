import { describe, expect, it } from "vitest";
import { describeDegradation } from "./describeDegradation";
import type { Degradation } from "./types";

function healthy(): Degradation {
  return {
    mapLlm: 14,
    mapFallback: 0,
    mapBudgetDenied: 0,
    mapParseFailed: 0,
    reduceMode: "llm",
    mapClaimsProposed: 5,
    mapClaimsKept: 5,
    reduceClaimsProposed: 2,
    reduceClaimsKept: 2,
    dropReasons: {},
  };
}

describe("describeDegradation", () => {
  it("returns null when nothing degraded", () => {
    expect(describeDegradation(healthy())).toBeNull();
  });

  it("returns null when the reduce step is a pure function by design, not a degradation", () => {
    expect(describeDegradation({ ...healthy(), reduceMode: "pure" })).toBeNull();
  });

  it("flags any map fallback", () => {
    const msg = describeDegradation({ ...healthy(), mapFallback: 3 });
    expect(msg).toMatch(/3 unit\(s\) fell back to heuristic map/);
  });

  it("flags any map budget denial", () => {
    const msg = describeDegradation({ ...healthy(), mapBudgetDenied: 1 });
    expect(msg).toMatch(/1 unit\(s\) denied budget on map/);
  });

  it("flags a reduce step that fell back or was denied", () => {
    expect(describeDegradation({ ...healthy(), reduceMode: "fallback" })).toMatch(/reduce ran in fallback mode/);
    expect(describeDegradation({ ...healthy(), reduceMode: "budget_denied" })).toMatch(
      /reduce ran in budget_denied mode/,
    );
  });

  it("does NOT flag skipped_no_units as a degradation", () => {
    expect(describeDegradation({ ...healthy(), reduceMode: "skipped_no_units" })).toBeNull();
  });

  // The load-bearing case: a verifier dropping everything looks identical
  // to a model that genuinely found nothing, unless proposed-vs-kept is
  // counted and surfaced.
  it("flags when the map verifier keeps less than half of what was proposed", () => {
    const msg = describeDegradation({ ...healthy(), mapClaimsProposed: 10, mapClaimsKept: 4 });
    expect(msg).toMatch(/map verifier kept only 4\/10 proposed claims \(40%\)/);
  });

  it("does not flag a map verifier keeping exactly half or more", () => {
    expect(describeDegradation({ ...healthy(), mapClaimsProposed: 10, mapClaimsKept: 5 })).toBeNull();
  });

  it("does not flag when nothing was proposed at all (an honest quiet night)", () => {
    expect(describeDegradation({ ...healthy(), mapClaimsProposed: 0, mapClaimsKept: 0 })).toBeNull();
  });

  it("flags when the reduce verifier keeps less than half of what was proposed", () => {
    const msg = describeDegradation({ ...healthy(), reduceClaimsProposed: 4, reduceClaimsKept: 1 });
    expect(msg).toMatch(/reduce verifier kept only 1\/4 proposed claims \(25%\)/);
  });

  it("joins multiple simultaneous reasons with a semicolon", () => {
    const msg = describeDegradation({ ...healthy(), mapFallback: 2, mapBudgetDenied: 1 });
    expect(msg).toBe("2 unit(s) fell back to heuristic map; 1 unit(s) denied budget on map");
  });
});
