import { describe, expect, it } from "vitest";
import { parseScoutingDossierResponse } from "./parseScoutingDossierResponse";

const validRaw = {
  formTrajectory: "Trending up after two finishes.",
  stylisticProfile: "Relentless forward pressure, finishes by ground and pound.",
  durability: "Has never been finished in the sample shown.",
  layoff: "Six months since the last bout, a normal camp cycle.",
  citedBoutIds: ["bout-1", "bout-2"],
  citedFlagIds: ["flag-1"],
};

describe("parseScoutingDossierResponse", () => {
  it("parses a well-formed response into one claim carrying the given fighterId", () => {
    const claims = parseScoutingDossierResponse(validRaw, "f1");
    expect(claims).toEqual([
      {
        fighterId: "f1",
        formTrajectory: validRaw.formTrajectory,
        stylisticProfile: validRaw.stylisticProfile,
        durability: validRaw.durability,
        layoff: validRaw.layoff,
        citedBoutIds: ["bout-1", "bout-2"],
        citedFlagIds: ["flag-1"],
      },
    ]);
  });

  it("trims whitespace off each prose field", () => {
    const claims = parseScoutingDossierResponse({ ...validRaw, formTrajectory: "  padded  " }, "f1");
    expect(claims[0].formTrajectory).toBe("padded");
  });

  it("defaults a missing citedFlagIds to an empty array rather than throwing", () => {
    const withoutFlags: Record<string, unknown> = { ...validRaw };
    delete withoutFlags.citedFlagIds;
    const claims = parseScoutingDossierResponse(withoutFlags, "f1");
    expect(claims[0].citedFlagIds).toEqual([]);
  });

  it("defaults a malformed (non-array) citedBoutIds to an empty array", () => {
    const claims = parseScoutingDossierResponse({ ...validRaw, citedBoutIds: "bout-1" }, "f1");
    expect(claims[0].citedBoutIds).toEqual([]);
  });

  it("filters non-string entries out of a citation array rather than throwing", () => {
    const claims = parseScoutingDossierResponse({ ...validRaw, citedBoutIds: ["bout-1", 42, null] }, "f1");
    expect(claims[0].citedBoutIds).toEqual(["bout-1"]);
  });

  // Prose fields are the one part of the response a caller cannot
  // sensibly default -- an empty dossier that looks like a real one is
  // worse than an explicit failure the map step falls back from.
  it.each(["formTrajectory", "stylisticProfile", "durability", "layoff"])(
    "throws when %s is missing",
    (field) => {
      const missingField: Record<string, unknown> = { ...validRaw };
      delete missingField[field];
      expect(() => parseScoutingDossierResponse(missingField, "f1")).toThrow();
    },
  );

  it("throws when the top level isn't an object at all", () => {
    expect(() => parseScoutingDossierResponse("not an object", "f1")).toThrow();
    expect(() => parseScoutingDossierResponse(null, "f1")).toThrow();
  });

  it("throws when a prose field is present but not a string", () => {
    expect(() => parseScoutingDossierResponse({ ...validRaw, durability: 123 }, "f1")).toThrow();
  });

  it("throws when a prose field is an empty/whitespace-only string", () => {
    expect(() => parseScoutingDossierResponse({ ...validRaw, layoff: "   " }, "f1")).toThrow();
  });
});
