import { describe, expect, it } from "vitest";
import { mergePickFields } from "./mergePickFields";
import type { PickFields } from "./types";

// A data-merging rule (ARCHITECTURE.md's correctness-critical category):
// C3's quick pick writes {predictedFighterId, estimatedProbability,
// confidence} only, and C4's bet controls write {betFighterId,
// stakeUnits, ...} only -- neither surface should be able to silently
// wipe out fields the *other* surface owns just because its own save
// didn't mention them. Get this wrong and re-tapping a quick-pick band
// after already placing a bet would erase the bet with no UI action that
// looks like "delete my bet."
const FIGHTER_A = "fighter-a";
const FIGHTER_B = "fighter-b";

const FULL_ROW: PickFields = {
  predictedFighterId: FIGHTER_A,
  estimatedProbability: 0.65,
  confidence: 4,
  predictedMethod: "DECISION",
  reasoning: "Better wrestling",
  betFighterId: FIGHTER_B,
  stakeUnits: 2,
};

describe("mergePickFields", () => {
  it("builds a fresh row from updates when no existing row is present", () => {
    const result = mergePickFields(null, {
      predictedFighterId: FIGHTER_A,
      estimatedProbability: 0.6,
      confidence: 3,
    });
    expect(result).toEqual({
      predictedFighterId: FIGHTER_A,
      estimatedProbability: 0.6,
      confidence: 3,
      predictedMethod: null,
      reasoning: null,
      betFighterId: null,
      stakeUnits: null,
    });
  });

  it("throws when no existing row and a required field is missing (a bet action can't create a pick out of thin air)", () => {
    expect(() =>
      mergePickFields(null, { betFighterId: FIGHTER_B, stakeUnits: 2 }),
    ).toThrow(/predictedFighterId|estimatedProbability|confidence/i);
  });

  it("a quick-pick-shaped update preserves an existing bet untouched", () => {
    const result = mergePickFields(FULL_ROW, {
      predictedFighterId: FIGHTER_A,
      estimatedProbability: 0.7,
      confidence: 3,
    });
    expect(result.betFighterId).toBe(FIGHTER_B);
    expect(result.stakeUnits).toBe(2);
    expect(result.reasoning).toBe("Better wrestling");
    expect(result.estimatedProbability).toBe(0.7);
  });

  it("a bet-shaped update preserves the existing pick untouched", () => {
    const result = mergePickFields(FULL_ROW, {
      betFighterId: FIGHTER_A,
      stakeUnits: 1.5,
    });
    expect(result.predictedFighterId).toBe(FIGHTER_A);
    expect(result.estimatedProbability).toBe(0.65);
    expect(result.betFighterId).toBe(FIGHTER_A);
    expect(result.stakeUnits).toBe(1.5);
  });

  it("an explicit null in updates clears a field rather than being treated as 'unspecified' (removing a bet)", () => {
    const result = mergePickFields(FULL_ROW, { betFighterId: null, stakeUnits: null });
    expect(result.betFighterId).toBeNull();
    expect(result.stakeUnits).toBeNull();
    // Untouched fields still survive.
    expect(result.predictedFighterId).toBe(FIGHTER_A);
  });
});
