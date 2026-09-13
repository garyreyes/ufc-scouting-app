import { describe, expect, it } from "vitest";
import { checkMergeGuard, decideAutoMerge, type MergeCandidateFighter } from "./decideSameCardMerge";

function fighter(overrides: Partial<MergeCandidateFighter> = {}): MergeCandidateFighter {
  return { id: "id-1", name: "Someone", external_id: null, sherdog_id: null, ...overrides };
}

describe("checkMergeGuard", () => {
  it("prefers the fighter carrying an external_id as the keeper", () => {
    const withId = fighter({ id: "b", external_id: "2759" });
    const withoutId = fighter({ id: "a", external_id: null });
    const result = checkMergeGuard(withoutId, withId);
    expect(result).toEqual({ allowed: true, keepId: "b", dropId: "a" });
  });

  it("breaks a tie between two external_id-carrying fighters on the lowest id", () => {
    const first = fighter({ id: "a", external_id: "1" });
    const second = fighter({ id: "b", external_id: "2" });
    expect(checkMergeGuard(second, first)).toEqual({ allowed: true, keepId: "a", dropId: "b" });
  });

  it("breaks a tie between two fighters with neither having an external_id on the lowest id", () => {
    const first = fighter({ id: "a" });
    const second = fighter({ id: "b" });
    expect(checkMergeGuard(second, first)).toEqual({ allowed: true, keepId: "a", dropId: "b" });
  });

  it("refuses to merge two fighters with different confirmed Sherdog identities", () => {
    const a = fighter({ id: "a", sherdog_id: 11111 });
    const b = fighter({ id: "b", sherdog_id: 22222 });
    expect(checkMergeGuard(a, b)).toEqual({ allowed: false, reason: "conflicting_sherdog_ids" });
  });

  it("allows a merge when only one side has a Sherdog id", () => {
    const a = fighter({ id: "a", sherdog_id: 11111 });
    const b = fighter({ id: "b", sherdog_id: null });
    expect(checkMergeGuard(a, b)).toEqual({ allowed: true, keepId: "a", dropId: "b" });
  });

  it("allows a merge when both sides share the SAME confirmed Sherdog id", () => {
    const a = fighter({ id: "a", sherdog_id: 11111, external_id: "100" });
    const b = fighter({ id: "b", sherdog_id: 11111 });
    expect(checkMergeGuard(a, b)).toEqual({ allowed: true, keepId: "a", dropId: "b" });
  });
});

describe("decideAutoMerge", () => {
  it("is eligible for a genuine same-card name variant with no sherdog conflict", () => {
    const a = fighter({ id: "a", name: "Jose Delgado" });
    const b = fighter({ id: "b", name: "Jose Miguel Delgado", external_id: "2759" });
    expect(decideAutoMerge(a, b)).toEqual({ eligible: true, keepId: "b", dropId: "a" });
  });

  it("is not eligible when the names are not a recognized variant", () => {
    const a = fighter({ name: "Justin Gaethje" });
    const b = fighter({ name: "Arman Tsarukyan" });
    expect(decideAutoMerge(a, b)).toEqual({ eligible: false, reason: "not_a_variant" });
  });

  it("is not eligible when the names ARE a variant but the sherdog ids conflict", () => {
    const a = fighter({ id: "a", name: "Sean King", sherdog_id: 48323 });
    const b = fighter({ id: "b", name: "Sean King III", sherdog_id: 423706 });
    expect(decideAutoMerge(a, b)).toEqual({ eligible: false, reason: "conflicting_sherdog_ids" });
  });
});
