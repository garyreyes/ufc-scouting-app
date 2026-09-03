import { normalizeName } from "./normalizeName";

/**
 * Whether two names refer to the same fighter, after folding case,
 * diacritics, and whitespace -- and NOTHING beyond that. Deliberately
 * an exact match on the normalized form, never a fuzzy one: this backs
 * upsertFighter.ts's own sync-merge fallback (I2b), where a false
 * positive silently attaches one real fighter's data to a different
 * person, and nothing downstream would ever notice. nameSimilarity.ts's
 * fuzzy score is for review queues a human looks at
 * (matchFighterCandidate.ts); this is for an automatic, unattended write.
 */
export function namesMatchExactly(a: string, b: string): boolean {
  return normalizeName(a) === normalizeName(b);
}
