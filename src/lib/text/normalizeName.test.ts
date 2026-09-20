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

  // D1, real production case (ROADMAP_V2.md Phase P, 2026-09-20): "Choi
  // Doo-ho" / "Dooho Choi" should have folded under
  // namesLikelySamePerson's existing name-order-swap rule but didn't,
  // purely because the hyphen survived normalization as its own
  // character, so "doo-ho" never matched the single token "dooho".
  // Stripping punctuation (not replacing it with a space) is what makes
  // the two sides collapse to the same token.
  it("folds a hyphen out entirely, not into a space", () => {
    expect(normalizeName("Choi Doo-ho")).toBe("choi dooho");
  });

  it("folds an apostrophe out entirely", () => {
    expect(normalizeName("O'Malley")).toBe("omalley");
  });

  it("folds a period out entirely, without leaving a double space", () => {
    expect(normalizeName("St. Pierre")).toBe("st pierre");
  });
});
