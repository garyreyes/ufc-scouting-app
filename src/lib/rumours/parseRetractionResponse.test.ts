import { describe, expect, it } from "vitest";
import { parseRetractionResponse } from "./parseRetractionResponse";

describe("parseRetractionResponse", () => {
  it("accepts a well-formed retract decision", () => {
    const raw = {
      decisions: [
        { flagId: "flag-1", action: "retract", supersededByUri: "at://p1", rationale: "made weight" },
      ],
    };
    expect(parseRetractionResponse(raw)).toEqual([
      { flagId: "flag-1", action: "retract", supersededByUri: "at://p1", rationale: "made weight" },
    ]);
  });

  it("accepts a well-formed keep decision with a null supersededByUri", () => {
    const raw = { decisions: [{ flagId: "flag-1", action: "keep", supersededByUri: null, rationale: "still open" }] };
    expect(parseRetractionResponse(raw)).toEqual([
      { flagId: "flag-1", action: "keep", supersededByUri: null, rationale: "still open" },
    ]);
  });

  it("defaults a missing supersededByUri to null rather than dropping the decision", () => {
    const raw = { decisions: [{ flagId: "flag-1", action: "keep", rationale: "still open" }] };
    expect(parseRetractionResponse(raw)[0].supersededByUri).toBeNull();
  });

  it("throws on a top-level shape missing the decisions array", () => {
    expect(() => parseRetractionResponse({ notDecisions: [] })).toThrow(/missing a "decisions" array/);
  });

  it("throws on a completely malformed top-level response", () => {
    expect(() => parseRetractionResponse(null)).toThrow(/missing a "decisions" array/);
    expect(() => parseRetractionResponse("just a string")).toThrow(/missing a "decisions" array/);
  });

  it("skips (not throws on) an individual malformed decision, keeping the well-formed ones", () => {
    const raw = {
      decisions: [
        { flagId: "flag-1", action: "keep", rationale: "fine" },
        { action: "keep", rationale: "missing flagId" },
        { flagId: "flag-2", action: "unsure", rationale: "invalid action" },
        { flagId: "flag-3", action: "retract" }, // missing rationale
        "not even an object",
      ],
    };
    const result = parseRetractionResponse(raw);
    expect(result).toEqual([{ flagId: "flag-1", action: "keep", supersededByUri: null, rationale: "fine" }]);
  });

  it("trims whitespace from rationale", () => {
    const raw = { decisions: [{ flagId: "flag-1", action: "keep", rationale: "  trimmed  " }] };
    expect(parseRetractionResponse(raw)[0].rationale).toBe("trimmed");
  });

  it("returns an empty array for an empty decisions list", () => {
    expect(parseRetractionResponse({ decisions: [] })).toEqual([]);
  });
});
