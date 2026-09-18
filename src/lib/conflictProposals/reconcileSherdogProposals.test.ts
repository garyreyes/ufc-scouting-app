import { describe, expect, it } from "vitest";
import { reconcileSherdogProposals } from "./reconcileSherdogProposals";
import type { SherdogProposalClaim } from "./types";

function claim(overrides: Partial<SherdogProposalClaim> = {}): SherdogProposalClaim {
  return { conflictId: "conflict-1", chosenSherdogId: 100, rationale: "matches", ...overrides };
}

describe("reconcileSherdogProposals", () => {
  it("keeps a single claim unchanged", () => {
    const result = reconcileSherdogProposals([claim()]);
    expect(result).toEqual([claim()]);
  });

  it("keeps claims for different conflicts choosing different sherdog ids", () => {
    const claims = [
      claim({ conflictId: "c1", chosenSherdogId: 100 }),
      claim({ conflictId: "c2", chosenSherdogId: 200 }),
    ];
    expect(reconcileSherdogProposals(claims)).toEqual(claims);
  });

  it("keeps every claim that proposes null (no confident match) -- null can never collide", () => {
    const claims = [
      claim({ conflictId: "c1", chosenSherdogId: null }),
      claim({ conflictId: "c2", chosenSherdogId: null }),
      claim({ conflictId: "c3", chosenSherdogId: null }),
    ];
    expect(reconcileSherdogProposals(claims)).toEqual(claims);
  });

  // The load-bearing case: fighters.sherdog_id is UNIQUE (0036), so two
  // different fighters can never both actually be linked to the same
  // Sherdog id -- if two different open conflicts each propose the same
  // id, at most one can ever be real evidence, and this must not let
  // both proposals stand as if they could both be accepted.
  it("drops the SECOND claim when two different conflicts propose the same sherdog id, keeping the first", () => {
    const claims = [
      claim({ conflictId: "c1", chosenSherdogId: 555, rationale: "first" }),
      claim({ conflictId: "c2", chosenSherdogId: 555, rationale: "second" }),
    ];
    const result = reconcileSherdogProposals(claims);
    expect(result).toEqual([claim({ conflictId: "c1", chosenSherdogId: 555, rationale: "first" })]);
  });

  it("drops every claim after the first when three or more conflicts collide on the same id", () => {
    const claims = [
      claim({ conflictId: "c1", chosenSherdogId: 555 }),
      claim({ conflictId: "c2", chosenSherdogId: 555 }),
      claim({ conflictId: "c3", chosenSherdogId: 555 }),
    ];
    const result = reconcileSherdogProposals(claims);
    expect(result).toEqual([claim({ conflictId: "c1", chosenSherdogId: 555 })]);
  });

  it("processes independent collisions correctly in the same batch", () => {
    const claims = [
      claim({ conflictId: "c1", chosenSherdogId: 100 }),
      claim({ conflictId: "c2", chosenSherdogId: 200 }),
      claim({ conflictId: "c3", chosenSherdogId: 100 }), // collides with c1
      claim({ conflictId: "c4", chosenSherdogId: null }),
    ];
    const result = reconcileSherdogProposals(claims);
    expect(result.map((c) => c.conflictId)).toEqual(["c1", "c2", "c4"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(reconcileSherdogProposals([])).toEqual([]);
  });
});
