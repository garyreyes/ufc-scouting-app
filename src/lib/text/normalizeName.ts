import { foldDiacritics } from "./foldDiacritics";

// Extracted from nameSimilarity.ts's own internal normalize() (I2b) once
// namesMatchExactly.ts needed the identical fold+case+whitespace
// handling for a different purpose (an exact-after-normalizing
// comparison, not a fuzzy one).
//
// D1 (ROADMAP_V2.md Phase P, 2026-09-20): punctuation is stripped
// (removed, not replaced with a space) before the whitespace collapse.
// "Choi Doo-ho" must fold to "choi dooho" -- a single token -- to match
// "Dooho Choi" under namesLikelySamePerson's existing name-order-swap
// rule; replacing the hyphen with a space instead would produce a THIRD
// token and never match at all. This deliberately doesn't add a new
// matching rule -- it only lets the existing rules see through
// punctuation the same way they already see through diacritics and case.
export function normalizeName(name: string): string {
  return foldDiacritics(name)
    .toLowerCase()
    .replace(/[-'.]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}
