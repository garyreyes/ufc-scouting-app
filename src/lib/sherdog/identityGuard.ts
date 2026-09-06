import { normalizeName } from "../text/normalizeName";
import { nameSimilarity } from "../text/nameSimilarity";

// Sherdog routes /fighter/<slug>-<id> on the trailing <id> ALONE and
// ignores the slug -- verified live 2026-09-07: /fighter/x-99999 returned
// a 200 page for a completely different real fighter ("Larry Bo
// Johnson"), and /fighter/Totally-Made-Up-76836 returned Islam
// Makhachev. So a wrong stored sherdog_id does not 404; it silently
// fetches SOMEONE ELSE, with a fully-populated page and no error. This is
// the db-read-safety "silently wrong, identically shaped" class: nothing
// downstream would ever notice a fighter's whole history was quietly
// swapped for another person's.
//
// Every fetch-then-write path MUST gate on this guard: the name on the
// page that came back has to plausibly be the fighter we asked for, or
// the write is abandoned and the fighter is surfaced, never written.
//
// The match is deliberately LOOSE on word order and diacritics but TIGHT
// on identity, because Sherdog stores its own name conventions:
// "Aori Qileng" is filed as "Qileng Aori", "André" may be "Andre". What
// it must still reject is a genuinely different person.

const FUZZY_FLOOR = 0.8;

function tokenSet(name: string): Set<string> {
  return new Set(normalizeName(name).split(" ").filter(Boolean));
}

function isSubset(inner: Set<string>, outer: Set<string>): boolean {
  for (const t of inner) if (!outer.has(t)) return false;
  return true;
}

/**
 * Whether the name on a fetched Sherdog page plausibly belongs to the
 * fighter we requested by id. Returns true to allow a write, false to
 * abandon it.
 *
 * Order of checks, loosest-acceptable to strictest-reject:
 *  1. exact after normalize (fold diacritics, case, whitespace) -- the
 *     common case.
 *  2. one name's word set is a subset of the other's AND they share at
 *     least two words -- covers a name-order swap ("Qileng Aori" vs
 *     "Aori Qileng"), a nickname baked into one side ("Charles do Bronx
 *     Oliveira" vs "Charles Oliveira"), or a dropped middle name. The
 *     two-word floor stops "John Smith" matching "John Jones".
 *  3. bigram similarity >= 0.8 -- covers spelling drift the fold misses
 *     (transliteration, an extra/missing letter).
 *  4. otherwise: different people. Reject.
 */
export function sherdogNameMatchesExpected(expected: string, pageName: string): boolean {
  const a = normalizeName(expected);
  const b = normalizeName(pageName);
  if (!a || !b) return false;
  if (a === b) return true;

  const ta = tokenSet(expected);
  const tb = tokenSet(pageName);
  const shared = [...ta].filter((t) => tb.has(t)).length;
  if (shared >= 2 && (isSubset(ta, tb) || isSubset(tb, ta))) return true;

  return nameSimilarity(expected, pageName) >= FUZZY_FLOOR;
}
