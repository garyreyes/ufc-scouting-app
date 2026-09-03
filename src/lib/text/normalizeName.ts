import { foldDiacritics } from "./foldDiacritics";

// Extracted from nameSimilarity.ts's own internal normalize() (I2b) once
// namesMatchExactly.ts needed the identical fold+case+whitespace
// handling for a different purpose (an exact-after-normalizing
// comparison, not a fuzzy one).
export function normalizeName(name: string): string {
  return foldDiacritics(name).toLowerCase().trim().replace(/\s+/g, " ");
}
