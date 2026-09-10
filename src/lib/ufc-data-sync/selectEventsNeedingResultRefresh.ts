export interface RefreshCandidateEvent {
  id: string;
  /** The `events.external_id`. For a Wikipedia-originated event this is
   *  the page title (what fetchEventSchedule needs); for an API-Sports
   *  one it is a bare number, which cannot be fetched from Wikipedia. */
  externalId: string;
  /** ISO YYYY-MM-DD. */
  eventDate: string;
  mergedInto: string | null;
}

export interface RefreshWindow {
  /** Inclusive floor — the oldest event date the recent-results refresh
   *  will re-fetch. Older than this is the I4 historical backfill's job
   *  (and those results are already stable). */
  earliest: string;
  /** Exclusive ceiling — today. A card dated today may still be live and
   *  its results may not be final; syncSchedule.ts's upcoming loop owns
   *  every event with `event_date >= today` anyway. */
  today: string;
}

const NUMERIC_ONLY = /^\d+$/;

/**
 * L2: which recently-finished cards need their Wikipedia results pulled.
 *
 * `syncSchedule.ts` stops covering a card the moment it leaves
 * `Category:Scheduled mixed martial arts events` (≈ when it finishes), and
 * the I4 backfill (`backfillWikipediaHistory.ts`) is gap-only — it skips
 * any event that already has fights. So a card synced while upcoming never
 * gets its `wikipedia_*` per-source result columns written, and
 * `evaluateFightSettlement` either settles it single-source on API-Sports'
 * ~3-day window or, if API-Sports missed a bout, never settles it at all.
 *
 * This picks the events a targeted re-fetch should cover:
 *   - `earliest <= event_date < today` — strictly past, inside the window;
 *   - not merged away (a K1/K2 tombstone);
 *   - `external_id` is a Wikipedia page title, not an API-Sports numeric id
 *     (those cannot be fetched from Wikipedia; such an event, if it needs
 *     Wikipedia data, is a duplicate the K-merge should fold, not this
 *     job's problem);
 *   - the event still has at least one fight with no `wikipedia_reported_at`
 *     — once every bout has a Wikipedia report there is nothing to refresh.
 *
 * De-duplicated and sorted oldest-first (legibility only; settlement and
 * Elo don't care about order).
 */
export function selectEventsNeedingResultRefresh(
  events: RefreshCandidateEvent[],
  eventIdsWithUnreportedFight: Set<string>,
  window: RefreshWindow,
): string[] {
  const seen = new Set<string>();
  const chosen: { title: string; date: string }[] = [];

  for (const event of events) {
    if (event.mergedInto !== null) continue;
    if (event.eventDate < window.earliest || event.eventDate >= window.today) continue;
    if (NUMERIC_ONLY.test(event.externalId)) continue;
    if (!eventIdsWithUnreportedFight.has(event.id)) continue;
    if (seen.has(event.externalId)) continue;
    seen.add(event.externalId);
    chosen.push({ title: event.externalId, date: event.eventDate });
  }

  return chosen
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((c) => c.title);
}
