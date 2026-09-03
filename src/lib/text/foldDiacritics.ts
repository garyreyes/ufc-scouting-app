// Extracted from nameSimilarity.ts's own internal normalize() (I2) once
// searchFighters.ts needed the identical fold for a different reason:
// nameSimilarity uses it so comparison tolerates accents, searchFighters
// uses it because API-Sports' own search endpoint outright REJECTS them
// (found live, 2026-09-03 -- see sanitizeSearchQuery.ts).
//
// Known limitation, unchanged from where this lived before: precomposed
// letters that aren't decomposable via NFD (e.g. Polish ł/Ł) are NOT
// folded to their Latin look-alike.
export function foldDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}
