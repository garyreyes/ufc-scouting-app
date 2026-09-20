export interface FighterCheckStatus {
  id: string;
  sherdogCheckedAt: string | null;
}

/**
 * I2 (ROADMAP_V2.md Phase P, Tier 3): every fighter on an upcoming card
 * whose Sherdog identity has never been attempted. `upcomingCardFighterIds`
 * is scoped by the caller the same way resolveSherdogIdentityJob.ts already
 * scopes its own queue (events with event_date >= today -> fights ->
 * fighter ids) -- this function only does the final filter, not the join.
 */
export function detectMissingSherdogChecks(
  upcomingCardFighterIds: Set<string>,
  fighters: FighterCheckStatus[],
): string[] {
  return fighters
    .filter((f) => upcomingCardFighterIds.has(f.id) && f.sherdogCheckedAt === null)
    .map((f) => f.id);
}
