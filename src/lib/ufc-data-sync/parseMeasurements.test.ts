import { describe, expect, it } from "vitest";
import { parseHeightToCm, parseReachToCm, parseWeightToKg } from "./parseMeasurements";

describe("parseHeightToCm", () => {
  it("parses the API's feet'inches' format", () => {
    expect(parseHeightToCm("6' 0'")).toBe(183);
  });

  it("handles inches without the trailing quote character", () => {
    expect(parseHeightToCm("5' 11")).toBe(180);
  });

  it("returns null for null input", () => {
    expect(parseHeightToCm(null)).toBeNull();
  });

  it("returns null for text it cannot parse", () => {
    expect(parseHeightToCm("unknown")).toBeNull();
  });
});

describe("parseReachToCm", () => {
  it("parses the API's inches-only format", () => {
    expect(parseReachToCm("75'")).toBe(191);
  });

  it("returns null for null input", () => {
    expect(parseReachToCm(null)).toBeNull();
  });
});

describe("parseWeightToKg", () => {
  it("parses the API's 'NNN lbs' format", () => {
    expect(parseWeightToKg("186 lbs")).toBe(84);
  });

  it("returns null for null input", () => {
    expect(parseWeightToKg(null)).toBeNull();
  });

  it("returns null for text it cannot parse", () => {
    expect(parseWeightToKg("unknown")).toBeNull();
  });
});
