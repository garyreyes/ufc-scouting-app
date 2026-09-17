export interface FighterIdentityRow {
  id: string;
  external_id?: string | null;
}

/**
 * Deterministic tie-break when more than one fighter row could be a
 * write's target -- a case-insensitive name collision, or several rows
 * folding to the same person via namesLikelySamePerson. Prefers the row
 * carrying an external_id, the identity API-Sports' results sync and
 * Sherdog both key on, and breaks any remaining tie on `id`, since
 * PostgREST makes no row-order guarantee on a plain select and picking
 * arbitrarily would let two rows keep ping-ponging which one gets each
 * write (L2b). Extracted from upsertFighter.ts's fold-match branch so the
 * same rule also covers a plain case-insensitive name collision, which
 * used to throw instead of resolving (M1).
 */
export function pickCanonicalFighter<T extends FighterIdentityRow>(rows: readonly T[]): T {
  if (rows.length === 0) throw new Error("pickCanonicalFighter called with no rows");
  const byId = (a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const withExternalId = [...rows].filter((r) => r.external_id != null).sort(byId);
  if (withExternalId.length > 0) return withExternalId[0];
  return [...rows].sort(byId)[0];
}
