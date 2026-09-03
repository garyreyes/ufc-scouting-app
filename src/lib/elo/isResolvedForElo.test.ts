import { describe, expect, it } from "vitest";
import { isResolvedForElo } from "./isResolvedForElo";

describe("isResolvedForElo", () => {
  it("includes a fight with a decisive winner", () => {
    expect(isResolvedForElo({ winnerId: "f1", method: "KO/TKO" })).toBe(true);
  });

  // The whole reason this replaced `settled_at IS NOT NULL`: a real
  // result already recorded on the row is a real result, whether or not
  // THIS app's settlement pipeline was the thing that recorded it.
  // 57 such fights existed in production and Elo could not see any of
  // them (ROADMAP.md Phase I).
  it("includes a resolved fight even though this app never ran settlement on it", () => {
    expect(isResolvedForElo({ winnerId: "f1", method: null })).toBe(true);
  });

  // A draw has no winner but is a real competitive result that must move
  // ratings 0.5/0.5. computeEloHistory decides what to DO with it; this
  // predicate only has to let it through.
  it("includes a draw -- no winner, but a method saying what happened", () => {
    expect(isResolvedForElo({ winnerId: null, method: "Draw (split)" })).toBe(true);
  });

  // A No Contest also reaches computeEloHistory, which is what excludes
  // it from moving any rating. Filtering it out here instead would put
  // that rule in two places.
  it("includes a No Contest, leaving computeEloHistory to exclude it from rating changes", () => {
    expect(isResolvedForElo({ winnerId: null, method: "NC (overturned)" })).toBe(true);
  });

  it("excludes a fight that has not happened yet", () => {
    expect(isResolvedForElo({ winnerId: null, method: null })).toBe(false);
  });
});
