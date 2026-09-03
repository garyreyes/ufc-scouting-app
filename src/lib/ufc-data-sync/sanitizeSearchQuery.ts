import { foldDiacritics } from "../text/foldDiacritics";

/**
 * API-Sports' `/fighters?search=` rejects anything but letters, digits
 * and spaces -- a real, previously-undocumented limit found live 2026-
 * 09-03 (I2's first production batch): 9 of 40 real fighters failed with
 * `"The Search field may only contain alpha-numeric characters and
 * spaces."` for diacritics (Maurício, José, Álvarez), hyphens (Doo-ho,
 * Joo-sang), apostrophes (O'Neill), and a trailing period (Aswell Jr.).
 *
 * **Only ever applied to the outgoing query, never to a stored name or a
 * candidate's own returned name.** decideFighterMatch.ts still compares
 * against the real name, diacritics and all -- this exists purely to get
 * a rejected request accepted, not to change what "a match" means.
 *
 * Folds diacritics to their plain-ASCII base first (Maurício -> Mauricio,
 * still a real, accurate query), then replaces any remaining disallowed
 * character with a space rather than deleting it outright -- so "Doo-ho"
 * becomes "Doo ho", not the harder-to-match "Dooho".
 */
export function sanitizeSearchQuery(name: string): string {
  return foldDiacritics(name)
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
