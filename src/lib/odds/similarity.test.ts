import { describe, expect, it } from "vitest";
import { nameSimilarity } from "./similarity";

// This is the correctness-critical core of odds<->fight matching
// (ARCHITECTURE.md item #6): a wrong match silently corrupts every
// downstream number, so the threshold behaviour here matters as much as
// the algorithm.
describe("nameSimilarity", () => {
  it("scores identical strings as 1", () => {
    expect(nameSimilarity("Alexandre Pantoja", "Alexandre Pantoja")).toBe(1);
  });

  it("is case-insensitive", () => {
    expect(nameSimilarity("JOSHUA VAN", "joshua van")).toBe(1);
  });

  it("scores completely different names near 0", () => {
    expect(nameSimilarity("Alexandre Pantoja", "Merab Dvalishvili")).toBeLessThan(0.3);
  });

  it("returns 0 for an empty string against a real name", () => {
    expect(nameSimilarity("", "Curtis Blaydes")).toBe(0);
    expect(nameSimilarity("Curtis Blaydes", "")).toBe(0);
  });

  it("folds decomposable diacritics to 1 (é -> e)", () => {
    expect(nameSimilarity("José Luiz", "Jose Luiz")).toBe(1);
  });

  // Known limitation, documented in similarity.ts: precomposed letters
  // that NFD doesn't decompose (Polish ł) aren't folded to their Latin
  // look-alike. This asserts the actual, tolerable degradation rather
  // than pretending it doesn't exist -- high but not perfect.
  it("scores a non-decomposable diacritic (ł) high but not 1", () => {
    const score = nameSimilarity("Klaudia Syguła", "Klaudia Sygula");
    expect(score).toBeGreaterThan(0.75);
    expect(score).toBeLessThan(1);
  });

  // The actual Phase 7 case (CHANGES.md): one source recorded "Diego
  // Ferreira", the other "Carlos Diego Ferreira" -- same person, extra
  // middle name. This must score clearly above "different people" and
  // clearly below "exact match" -- it's the realistic case a review
  // threshold has to separate correctly.
  it("scores a name with an extra middle name as a substantial, non-1 match", () => {
    const score = nameSimilarity("Carlos Diego Ferreira", "Diego Ferreira");
    expect(score).toBeGreaterThan(0.6);
    expect(score).toBeLessThan(1);
  });

  it("is symmetric", () => {
    const a = nameSimilarity("Manon Fiorot", "Alexa Grasso");
    const b = nameSimilarity("Alexa Grasso", "Manon Fiorot");
    expect(a).toBe(b);
  });

  it("does not double-count a repeated bigram", () => {
    // "aa" has bigrams ["aa"]; "aaaa" has bigrams ["aa","aa","aa"] -- the
    // consuming-match rule means only one of those three can match "aa"'s
    // single bigram, not all three.
    const score = nameSimilarity("aa", "aaaa");
    expect(score).toBeCloseTo((2 * 1) / (1 + 3), 5);
  });
});
