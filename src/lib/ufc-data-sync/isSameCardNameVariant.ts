import { normalizeName } from "../text/normalizeName";

// Same suffix pattern sherdogSearchQueries.ts already proved matters for
// real roster names ("Michael Aswell Jr." / "Michael Aswell").
const SUFFIX = /\s+(jr|sr|jr\.|sr\.|ii|iii|iv)\.?$/i;

function tokenSet(name: string): Set<string> {
  return new Set(normalizeName(name).split(" ").filter(Boolean));
}

function isSubset(inner: Set<string>, outer: Set<string>): boolean {
  for (const t of inner) if (!outer.has(t)) return false;
  return true;
}

/**
 * M3: whether two names could plausibly be the SAME fighter, given they
 * are already known to be the two candidates for one shared-opponent slot
 * on one card (a disputed_opponent conflict's kept vs. candidate pairing).
 * That context is what makes this safe to apply automatically -- it is
 * deliberately MORE permissive than the global `namesLikelySamePerson`
 * (which folds across the whole roster with no such guarantee, and
 * correctly refuses a bare suffix or nickname difference).
 *
 * Two rules, either sufficient:
 *  - stripping a trailing suffix (Jr./Sr./II/III/IV) makes them equal;
 *  - they share at least two tokens AND one name's token set is a subset
 *    of the other's (a dropped or added middle name).
 *
 * Never a bare nickname ("Renato Moicano" / "Renato Carneiro" -- Sherdog's
 * own filing name) -- only one token shared there, below the two-token
 * floor that stops a false positive on a single common first name.
 */
export function isSameCardNameVariant(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return true;

  const strippedA = na.replace(SUFFIX, "");
  const strippedB = nb.replace(SUFFIX, "");
  if (strippedA === strippedB) return true;

  const ta = tokenSet(a);
  const tb = tokenSet(b);
  const shared = [...ta].filter((t) => tb.has(t)).length;
  if (shared >= 2 && (isSubset(ta, tb) || isSubset(tb, ta))) return true;

  return false;
}
