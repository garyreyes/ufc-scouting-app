import { describe, expect, it } from "vitest";
import { normalizeName } from "./normalizeName";

describe("normalizeName", () => {
  it("folds diacritics", () => {
    expect(normalizeName("André")).toBe("andre");
  });

  it("lowercases", () => {
    expect(normalizeName("DAN HOOKER")).toBe("dan hooker");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeName("  Dan Hooker  ")).toBe("dan hooker");
  });

  it("collapses internal runs of whitespace to a single space", () => {
    expect(normalizeName("Dan   Hooker")).toBe("dan hooker");
  });

  // The real production case (I2b, 2026-09-03): these two are the same
  // person, and must normalize identically.
  it("makes 'Andre Lima' and 'André Lima' equal", () => {
    expect(normalizeName("Andre Lima")).toBe(normalizeName("André Lima"));
  });
});
