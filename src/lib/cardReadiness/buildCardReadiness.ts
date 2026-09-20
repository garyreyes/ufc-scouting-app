export interface CardReadinessInput {
  eventName: string;
  eventDate: string; // yyyy-mm-dd, events.event_date's own shape
  fightIds: string[];
  fighterIds: string[];
  pricedFightIds: Set<string>;
  sherdogCheckedFighterIds: Set<string>;
  openConflictCount: number;
}

export interface CardReadiness {
  eventName: string;
  eventDate: string;
  daysUntil: number;
  fightsTotal: number;
  fightsPriced: number;
  fightersTotal: number;
  fightersSherdogLinked: number;
  openConflicts: number;
}

/**
 * P9 (ROADMAP_V2.md Phase P): the pre-card number to look at before every
 * card -- turns "the data is accurate" from a hope into something read in
 * three seconds. Pure arithmetic over sets the caller has already scoped
 * to the one nearest upcoming event (getCardReadiness, features/job-health/
 * api.ts) -- this function doesn't itself know what "this card" means, the
 * same split as every detect-/select-prefixed function elsewhere in this codebase.
 *
 * "Sherdog-linked" reuses I2's own definition (sherdog_checked_at IS NOT
 * NULL, ROADMAP_V2.md) rather than a new one -- a fighter Sherdog
 * legitimately couldn't match still counts as "checked," since the point
 * is whether identity resolution has been attempted, not whether every
 * fighter has a Sherdog page.
 */
export function buildCardReadiness(input: CardReadinessInput, now: Date): CardReadiness {
  const eventDateMs = Date.parse(`${input.eventDate}T00:00:00Z`);
  const todayMs = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const daysUntil = Math.round((eventDateMs - todayMs) / (1000 * 60 * 60 * 24));

  return {
    eventName: input.eventName,
    eventDate: input.eventDate,
    daysUntil,
    fightsTotal: input.fightIds.length,
    fightsPriced: input.fightIds.filter((id) => input.pricedFightIds.has(id)).length,
    fightersTotal: input.fighterIds.length,
    fightersSherdogLinked: input.fighterIds.filter((id) => input.sherdogCheckedFighterIds.has(id)).length,
    openConflicts: input.openConflictCount,
  };
}
