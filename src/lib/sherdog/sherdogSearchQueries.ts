import { foldDiacritics } from "../text/foldDiacritics";

// Sherdog's fightfinder is pickier than the 2026-09-07 spike suggested.
// Confirmed live 2026-09-07 against real roster names:
//   "Édgar Cháirez"      -> 0 results ; "Edgar Chairez"  -> 1
//   "Michael Aswell Jr." -> 0 results ; "Michael Aswell" -> 1
// So a single raw query misses real fighters. searchSherdogFighters
// tries these variants in order and takes the first that returns
// anything -- distinct and de-duplicated, original form always first so
// an exact hit is never passed over for a normalized guess.

const SUFFIX = /\s+(jr|sr|jr\.|sr\.|ii|iii|iv)\.?$/i;

export function sherdogSearchQueries(name: string): string[] {
  const base = name.trim().replace(/\s+/g, " ");
  const out: string[] = [];
  const add = (q: string) => {
    const t = q.trim();
    if (t.length > 0 && !out.includes(t)) out.push(t);
  };

  add(base);
  add(foldDiacritics(base));
  add(base.replace(SUFFIX, ""));
  add(foldDiacritics(base).replace(SUFFIX, ""));

  return out;
}
