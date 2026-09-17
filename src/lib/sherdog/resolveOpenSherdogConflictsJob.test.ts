import { describe, it, expect } from "vitest";
import { isEligibleForHistoryCheck, MAX_CANDIDATES } from "./resolveOpenSherdogConflictsJob";
import type { LowConfidenceSherdogMatchDetails, SherdogMatchCandidate } from "../../features/conflicts/types";

function candidates(n: number): SherdogMatchCandidate[] {
  return Array.from({ length: n }, (_, i) => ({
    sherdogId: i + 1,
    name: "Someone",
    confidence: 1,
    nickname: null,
    heightImperial: null,
    weightImperial: null,
    association: null,
  }));
}

function details(
  reason: LowConfidenceSherdogMatchDetails["reason"],
  candidateCount: number,
): LowConfidenceSherdogMatchDetails {
  return {
    fighterId: "f1",
    storedName: "Someone",
    reason,
    candidates: candidates(candidateCount),
  };
}

describe("isEligibleForHistoryCheck (M5)", () => {
  it("is eligible for below_threshold and ambiguous, within the candidate cap", () => {
    expect(isEligibleForHistoryCheck(details("below_threshold", 1))).toBe(true);
    expect(isEligibleForHistoryCheck(details("ambiguous", MAX_CANDIDATES))).toBe(true);
  });

  it("skips guard_mismatch regardless of candidate count -- out of scope, not this feature's call to make", () => {
    expect(isEligibleForHistoryCheck(details("guard_mismatch", 1))).toBe(false);
  });

  it("skips an empty candidate list", () => {
    expect(isEligibleForHistoryCheck(details("below_threshold", 0))).toBe(false);
  });

  it("skips a candidate list over the cap", () => {
    expect(isEligibleForHistoryCheck(details("ambiguous", MAX_CANDIDATES + 1))).toBe(false);
  });
});
