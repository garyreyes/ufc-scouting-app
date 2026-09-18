import { describe, expect, it } from "vitest";
import { verifyClaims } from "../llm/verifyClaims";
import { sherdogProposalChecks } from "./sherdogProposalChecks";
import type { ConflictToPropose, SherdogProposalClaim } from "./types";

function conflict(overrides: Partial<ConflictToPropose> = {}): ConflictToPropose {
  return {
    conflictId: "conflict-1",
    storedName: "Renato Moicano",
    reason: "below_threshold",
    candidates: [
      { sherdogId: 111, name: "Renato Carneiro", confidence: 0.6, nickname: "Moicano", association: "Kings MMA" },
      { sherdogId: 222, name: "Renato Silva", confidence: 0.3, nickname: null, association: null },
    ],
    ...overrides,
  };
}

function facts(conflicts: ConflictToPropose[]) {
  return { conflictsById: new Map(conflicts.map((c) => [c.conflictId, c])) };
}

function claim(overrides: Partial<SherdogProposalClaim> = {}): SherdogProposalClaim {
  return { conflictId: "conflict-1", chosenSherdogId: 111, rationale: "romanized name variant", ...overrides };
}

describe("sherdogProposalChecks", () => {
  it("keeps a proposal choosing a real candidate id", () => {
    const result = verifyClaims([claim()], facts([conflict()]), sherdogProposalChecks);
    expect(result.kept).toEqual([claim()]);
  });

  it("keeps a null proposal (no confident match) unconditionally", () => {
    const c = claim({ chosenSherdogId: null, rationale: "not confident" });
    const result = verifyClaims([c], facts([conflict()]), sherdogProposalChecks);
    expect(result.kept).toEqual([c]);
  });

  // Never trust an invented id, the same rule every other surface's
  // checks apply to a model-cited value.
  it("drops a proposal citing a sherdogId that isn't one of this conflict's real candidates", () => {
    const c = claim({ chosenSherdogId: 999 });
    const result = verifyClaims([c], facts([conflict()]), sherdogProposalChecks);
    expect(result.kept).toEqual([]);
    expect(result.dropReasons).toEqual({ unknown_candidate: 1 });
  });

  it("drops a proposal for a conflict that no longer exists in facts", () => {
    const c = claim({ conflictId: "nonexistent" });
    const result = verifyClaims([c], facts([conflict()]), sherdogProposalChecks);
    expect(result.dropReasons).toEqual({ unknown_conflict_id: 1 });
  });

  it("checks the candidate id against the RIGHT conflict, not any conflict in facts", () => {
    // candidate 111 is real for conflict-1 but NOT for conflict-2
    const c2 = conflict({
      conflictId: "conflict-2",
      candidates: [{ sherdogId: 333, name: "Someone Else", confidence: 0.5, nickname: null, association: null }],
    });
    const claimForC2 = claim({ conflictId: "conflict-2", chosenSherdogId: 111 });
    const result = verifyClaims([claimForC2], facts([conflict(), c2]), sherdogProposalChecks);
    expect(result.kept).toEqual([]);
    expect(result.dropReasons).toEqual({ unknown_candidate: 1 });
  });
});
