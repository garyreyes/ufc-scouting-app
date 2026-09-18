import { describe, expect, it } from "vitest";
import { parseSherdogProposalResponse } from "./parseSherdogProposalResponse";

describe("parseSherdogProposalResponse", () => {
  it("accepts a well-formed proposal with a chosen id", () => {
    const raw = { chosenSherdogId: 111, rationale: "romanized name variant" };
    expect(parseSherdogProposalResponse(raw, "conflict-1")).toEqual([
      { conflictId: "conflict-1", chosenSherdogId: 111, rationale: "romanized name variant" },
    ]);
  });

  it("accepts a well-formed null proposal", () => {
    const raw = { chosenSherdogId: null, rationale: "not confident enough" };
    expect(parseSherdogProposalResponse(raw, "conflict-1")).toEqual([
      { conflictId: "conflict-1", chosenSherdogId: null, rationale: "not confident enough" },
    ]);
  });

  it("coerces a non-integer or non-numeric chosenSherdogId to null rather than throwing", () => {
    expect(parseSherdogProposalResponse({ chosenSherdogId: "111", rationale: "r" }, "c1")[0].chosenSherdogId).toBeNull();
    expect(parseSherdogProposalResponse({ chosenSherdogId: 1.5, rationale: "r" }, "c1")[0].chosenSherdogId).toBeNull();
    expect(parseSherdogProposalResponse({ rationale: "no id field at all" }, "c1")[0].chosenSherdogId).toBeNull();
  });

  it("throws when rationale is missing entirely", () => {
    expect(() => parseSherdogProposalResponse({ chosenSherdogId: 111 }, "c1")).toThrow(/missing expected fields/);
  });

  it("throws when rationale is not a string", () => {
    expect(() => parseSherdogProposalResponse({ chosenSherdogId: 111, rationale: 42 }, "c1")).toThrow(
      /non-string rationale/,
    );
  });

  it("throws on a completely malformed response", () => {
    expect(() => parseSherdogProposalResponse(null, "c1")).toThrow(/missing expected fields/);
    expect(() => parseSherdogProposalResponse("not an object", "c1")).toThrow(/missing expected fields/);
  });

  it("trims whitespace from rationale", () => {
    const raw = { chosenSherdogId: null, rationale: "  trimmed  " };
    expect(parseSherdogProposalResponse(raw, "c1")[0].rationale).toBe("trimmed");
  });

  it("always sets conflictId from the argument, never from the response", () => {
    const raw = { chosenSherdogId: null, rationale: "r" };
    expect(parseSherdogProposalResponse(raw, "the-real-conflict-id")[0].conflictId).toBe("the-real-conflict-id");
  });
});
