import { describe, expect, it } from "vitest";
import {
  flagPenalty,
  MAX_PENALTY_PER_FIGHTER,
  MAX_PENALTY_PER_FLAG,
  PENALTY_PER_SOURCE,
} from "./flagPenalty";
import type { InternFlag } from "./types";

function flag(corroborationCount: number): InternFlag {
  return { fighterId: "f1", category: "weight_cut", corroborationCount };
}

describe("flagPenalty", () => {
  it("is zero with no flags", () => {
    expect(flagPenalty([])).toBe(0);
  });

  it("scales with corroboration, not flag count alone", () => {
    expect(flagPenalty([flag(1)])).toBeCloseTo(PENALTY_PER_SOURCE, 10);
    expect(flagPenalty([flag(2)])).toBeCloseTo(PENALTY_PER_SOURCE * 2, 10);
  });

  // The whole reason F2 counts independent claims rather than raw post
  // volume: one loud story must not outweigh several separate ones.
  it("caps a single flag no matter how many sources back it", () => {
    expect(flagPenalty([flag(50)])).toBeCloseTo(MAX_PENALTY_PER_FLAG, 10);
  });

  it("adds separate flags together", () => {
    expect(flagPenalty([flag(1), flag(1)])).toBeCloseTo(PENALTY_PER_SOURCE * 2, 10);
  });

  it("caps the total per fighter", () => {
    const many = [flag(50), flag(50), flag(50), flag(50)];
    expect(flagPenalty(many)).toBeCloseTo(MAX_PENALTY_PER_FIGHTER, 10);
  });

  it("keeps the intern market-anchored: even a buried fighter moves less than 15 points", () => {
    const many = Array.from({ length: 20 }, () => flag(10));
    expect(flagPenalty(many)).toBeLessThan(0.15);
  });
});
