export interface PendingFight {
  fighter1_id: string;
  fighter2_id: string;
  eventDate: string;
}

/**
 * M4: reimportSherdogForPendingFights.ts's cap (12/run, default) used to
 * apply to a Set built from an unordered DB fetch -- effectively an
 * arbitrary subset of pending fighters, which could just as easily leave
 * the NEWEST card (the one most likely still waiting on a Sherdog answer)
 * uncovered while re-fetching fighters from an older one. Extracted pure
 * so the actual ordering rule is directly testable without a fake
 * Supabase client.
 */
export function orderSherdogIdsForReimport(
  pending: PendingFight[],
  sherdogIdByFighterId: Map<string, number | null | undefined>,
  maxFighters: number,
): number[] {
  const newestFirst = [...pending].sort((a, b) => (a.eventDate < b.eventDate ? 1 : a.eventDate > b.eventDate ? -1 : 0));
  const fighterIdsInOrder = [...new Set(newestFirst.flatMap((f) => [f.fighter1_id, f.fighter2_id]))];
  const sherdogIds = [
    ...new Set(
      fighterIdsInOrder
        .map((id) => sherdogIdByFighterId.get(id))
        .filter((id): id is number => id != null),
    ),
  ];
  return sherdogIds.slice(0, maxFighters);
}
