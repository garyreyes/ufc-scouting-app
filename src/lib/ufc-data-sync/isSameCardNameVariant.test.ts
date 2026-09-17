import { describe, expect, it } from "vitest";
import { isSameCardNameVariant } from "./isSameCardNameVariant";

describe("isSameCardNameVariant", () => {
  it("matches names differing only by a suffix", () => {
    expect(isSameCardNameVariant("Sean King", "Sean King III")).toBe(true);
    expect(isSameCardNameVariant("Michael Aswell", "Michael Aswell Jr.")).toBe(true);
  });

  // Deliberately more permissive than the global namesLikelySamePerson:
  // this function is only ever applied to two candidates already known to
  // be the SAME opponent on the SAME card, a context that makes a suffix
  // collision safe to treat as a variant. namesLikelySamePerson has no
  // such guarantee across the whole roster and correctly stays stricter.
  it("matches a bare suffix difference, unlike the global fold-match", () => {
    expect(isSameCardNameVariant("Dan Hooker", "Dan Hooker Jr")).toBe(true);
  });

  it("matches a dropped middle name (at least two shared tokens, one side a subset)", () => {
    expect(isSameCardNameVariant("Jose Delgado", "Jose Miguel Delgado")).toBe(true);
  });

  it("matches an exact name after case/diacritic/whitespace folding", () => {
    expect(isSameCardNameVariant("André Lima", "andre  lima")).toBe(true);
  });

  it("does not match two genuinely different people", () => {
    expect(isSameCardNameVariant("Justin Gaethje", "Arman Tsarukyan")).toBe(false);
  });

  it("does not match on a single shared token alone", () => {
    // "John Smith" vs "John Jones" -- only "John" shared, must not match.
    expect(isSameCardNameVariant("John Smith", "John Jones")).toBe(false);
  });

  it("does not match a bare nickname with no shared middle/suffix structure", () => {
    // Real production case: Renato Moicano is stored under his own name on
    // one side; Sherdog files him as "Renato Carneiro." No suffix, no
    // subset relationship -- must not auto-merge on a nickname alone.
    expect(isSameCardNameVariant("Renato Moicano", "Renato Carneiro")).toBe(false);
  });
});
