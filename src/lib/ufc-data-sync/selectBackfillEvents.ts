export interface BackfillEventCandidate {
  /** The Wikipedia page title, which is also the event's external_id
   *  (see syncSchedule.ts: `external_id: title`). */
  title: string;
  /** ISO date (YYYY-MM-DD) parsed from the page's `{{start date}}`, or
   *  null when the page has no parseable date (a grappling card, a stub). */
  date: string | null;
}

export interface BackfillWindow {
  /** Inclusive floor — the oldest event date I4 will touch. */
  earliest: string;
  /** Exclusive ceiling — today. An event dated today or later is left to
   *  syncSchedule.ts, whose job upcoming/in-progress cards already are;
   *  its results may also not be final yet. */
  today: string;
}

/**
 * The Wikipedia past-event backfill's queue, kept pure so both boundary
 * conditions are tested rather than implied:
 *
 *  - `earliest <= date < today` — a strict upper bound so a card
 *    happening *today* is never reprocessed out from under syncSchedule.ts
 *    (which owns every scheduled/live event and runs twice daily);
 *  - `title not in alreadyBackfilled` — the resumable-queue check, mirror
 *    of backfillFightHistory.ts's `history_backfilled_at is null`. The
 *    caller builds this set from `events.wikipedia_backfilled_at is not
 *    null`, so an event that turned out resultless is still never
 *    re-fetched.
 *
 * ISO YYYY-MM-DD compares correctly as a plain string, so no Date parsing.
 * Result is de-duplicated (a title can appear in two year categories) and
 * sorted oldest-first — purely for legible progress; ingestion order does
 * not matter to Elo, which does a full rebuild.
 */
export function selectBackfillEvents(
  candidates: BackfillEventCandidate[],
  alreadyBackfilled: Set<string>,
  window: BackfillWindow,
): string[] {
  const seen = new Set<string>();
  const chosen: BackfillEventCandidate[] = [];

  for (const candidate of candidates) {
    const { title, date } = candidate;
    if (date === null) continue;
    if (date < window.earliest || date >= window.today) continue;
    if (alreadyBackfilled.has(title)) continue;
    if (seen.has(title)) continue;
    seen.add(title);
    chosen.push(candidate);
  }

  return chosen
    .sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0))
    .map((c) => c.title);
}
