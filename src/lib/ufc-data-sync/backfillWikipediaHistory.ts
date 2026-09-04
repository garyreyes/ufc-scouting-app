import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchEventSchedule, listUfcEventTitlesInCategoryYear } from "./fetchSchedule";
import { processScheduleEvent } from "./processScheduleEvent";
import { selectBackfillEvents } from "./selectBackfillEvents";

// I3 filled 2022-2024 fight history from API-Sports; its free tier
// refuses every season from 2025 on. I4 fills the 2025-to-now hole from
// Wikipedia's per-year UFC categories instead -- the same
// `{{MMAevent bout}}` template syncSchedule.ts already parses for
// upcoming cards carries the winner/method/round once a card has been
// contested (verified live, ROADMAP.md I4 spike).
export const BACKFILL_EARLIEST = "2025-01-01";

// Wikipedia's API starts returning 429 after ~6 rapid requests from one
// IP (found live building I4). One deliberate pause before every page
// fetch -- fetchEventSchedule makes exactly one request per event -- keeps
// a run comfortably under that. `listUfcEventTitlesInCategoryYear` also
// counts (1-2 requests per year), so the pause guards those too by
// sitting in the same job.
export const WIKI_REQUEST_SPACING_MS = 1500;

// ~55 in-window events exist as of I4. A run fetches at most this many
// pages (plus the year-category listings), so the whole backfill clears
// in ~4 daily runs, or a few manual workflow_dispatch runs the same day.
// Small enough that one 429 or one malformed page loses little work.
export const DEFAULT_EVENT_BATCH_SIZE = 15;

export interface BackfillWikipediaHistorySummary {
  candidateEvents: number;
  eventsAttempted: number;
  eventsWritten: number;
  fightsWritten: number;
  skippedUpcoming: number;
  skippedUndated: number;
  failed: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resumable with no dedicated queue table, same idea as I3's
 * backfillFightHistory.ts. The queue is a UFC event page in a year
 * category from 2025 on that is ALL of:
 *   - past-dated and inside the window (selectBackfillEvents, post-fetch);
 *   - not already stamped `wikipedia_backfilled_at`;
 *   - not an `events` row dated today-or-later (syncSchedule.ts owns those);
 *   - **not an `events` row that already carries fights** -- I4 only fills
 *     gaps, never reprocesses an event another sync path already built
 *     (see the pendingByTitle -> pending narrowing below for why).
 * An event is stamped once its results table has been parsed and its
 * bouts upserted; a genuinely resultless page (a cancelled card) is not
 * stamped but also not retried forever -- it just falls to the back of
 * each run's batch.
 */
export async function backfillWikipediaHistory(
  supabase: SupabaseClient,
  today: string = new Date().toISOString().slice(0, 10),
  batchSize: number = DEFAULT_EVENT_BATCH_SIZE,
): Promise<BackfillWikipediaHistorySummary> {
  const summary: BackfillWikipediaHistorySummary = {
    candidateEvents: 0,
    eventsAttempted: 0,
    eventsWritten: 0,
    fightsWritten: 0,
    skippedUpcoming: 0,
    skippedUndated: 0,
    failed: 0,
  };

  const firstYear = Number(BACKFILL_EARLIEST.slice(0, 4));
  const lastYear = Number(today.slice(0, 4));
  const categoryTitles: string[] = [];
  for (let year = firstYear; year <= lastYear; year++) {
    await sleep(WIKI_REQUEST_SPACING_MS);
    categoryTitles.push(...(await listUfcEventTitlesInCategoryYear(year)));
  }
  const uniqueTitles = [...new Set(categoryTitles)];

  const { data: eventRows, error } = await supabase
    .from("events")
    .select("id, external_id, event_date, wikipedia_backfilled_at");
  if (error) throw error;
  const eventByExternalId = new Map((eventRows ?? []).map((e) => [e.external_id as string, e]));

  const alreadyBackfilled = new Set(
    (eventRows ?? []).filter((e) => e.wikipedia_backfilled_at !== null).map((e) => e.external_id as string),
  );
  const knownUpcoming = new Set(
    (eventRows ?? []).filter((e) => (e.event_date as string) >= today).map((e) => e.external_id as string),
  );

  const pendingByTitle = uniqueTitles.filter(
    (title) => !alreadyBackfilled.has(title) && !knownUpcoming.has(title),
  );

  // I4 is a GAP filler. An event that already carries fights was synced by
  // another path -- syncSchedule.ts's upcoming sync, syncJob.ts's
  // API-Sports results sync, or a hand-curated repair -- and reprocessing
  // it is actively harmful: upsertFight's disputed-opponent guard fires
  // Wikipedia's version of every bout against the existing rows and
  // manufactures a conflict per bout (found live, first I4 run). Only an
  // event with no bouts yet, or no events row at all, is a real gap.
  const pendingEventIds = pendingByTitle
    .map((t) => eventByExternalId.get(t)?.id as string | undefined)
    .filter((id): id is string => Boolean(id));
  const eventIdsWithFights = new Set<string>();
  if (pendingEventIds.length > 0) {
    const { data: fightRows, error: fightErr } = await supabase
      .from("fights")
      .select("event_id")
      .in("event_id", pendingEventIds);
    if (fightErr) throw fightErr;
    for (const row of fightRows ?? []) eventIdsWithFights.add(row.event_id as string);
  }

  const pending = pendingByTitle.filter((title) => {
    const row = eventByExternalId.get(title);
    return !row || !eventIdsWithFights.has(row.id as string);
  });
  summary.candidateEvents = pending.length;

  const batch = pending.slice(0, batchSize);
  const fetched: { title: string; date: string | null; boutCount: number }[] = [];
  for (const title of batch) {
    summary.eventsAttempted++;
    try {
      await sleep(WIKI_REQUEST_SPACING_MS);
      const event = await fetchEventSchedule(title);
      fetched.push({ title, date: event.date, boutCount: event.bouts.length });

      if (event.date === null) {
        summary.skippedUndated++;
        continue;
      }
      if (
        selectBackfillEvents([{ title, date: event.date }], alreadyBackfilled, {
          earliest: BACKFILL_EARLIEST,
          today,
        }).length === 0
      ) {
        summary.skippedUpcoming++;
        continue;
      }

      const result = await processScheduleEvent(supabase, title, event);
      summary.eventsWritten++;
      summary.fightsWritten += result.fightCount;

      // Mark by the id processScheduleEvent actually resolved to, not by
      // `title` -- upsertEvent's name-match fallback can land on an
      // existing row whose external_id differs (the API-Sports vs
      // Wikipedia naming split), and an external_id-keyed update would
      // then silently touch nothing and re-fetch this event every run.
      const { error: touchError } = await supabase
        .from("events")
        .update({ wikipedia_backfilled_at: new Date().toISOString() })
        .eq("id", result.eventId);
      if (touchError) throw touchError;
    } catch (err) {
      summary.failed++;
      console.error(`Wikipedia history backfill failed for "${title}":`, err);
    }
  }

  return summary;
}
