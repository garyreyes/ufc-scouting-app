import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllPages } from "../supabase/selectAllPages";
import { fetchEventSchedule } from "./fetchSchedule";
import { processScheduleEvent } from "./processScheduleEvent";
import { WIKI_REQUEST_SPACING_MS } from "./backfillWikipediaHistory";
import {
  selectEventsNeedingResultRefresh,
  type RefreshCandidateEvent,
} from "./selectEventsNeedingResultRefresh";

// How far back a card can be and still get its Wikipedia results
// re-pulled. UFC runs ~weekly, so this covers ~4-5 cards -- enough to
// catch a result that posts a few days late or a correction (an appeal
// overturn), without ever reaching into the I4 historical backfill's
// territory, whose results are already stable.
export const REFRESH_WINDOW_DAYS = 30;

export interface RefreshRecentResultsSummary {
  windowEarliest: string;
  candidateTitles: string[];
  eventsRefreshed: number;
  fightsTouched: number;
  failed: number;
  dryRun: boolean;
}

interface EventRow {
  id: string;
  external_id: string;
  event_date: string;
  merged_into: string | null;
}

interface FightResultRow {
  id: string;
  event_id: string;
  wikipedia_reported_at: string | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function windowFloor(today: string, windowDays: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - windowDays);
  return d.toISOString().slice(0, 10);
}

/**
 * L2: re-pull Wikipedia results for cards that finished recently.
 *
 * `syncSchedule.ts` drops a card once it leaves `Category:Scheduled` (≈
 * when it finishes) and `backfillWikipediaHistory.ts` (I4) is gap-only, so
 * without this pass a card synced while upcoming never gets its
 * `wikipedia_*` per-source result columns. `evaluateFightSettlement` then
 * settles it single-source on API-Sports' ~3-day window at best, or --
 * for a bout API-Sports missed -- never.
 *
 * Runs at the tail of every schedule sync (syncSchedule.ts), immediately
 * before `sync.yml`'s settlement step, so a freshly-pulled result settles
 * the same run (or 24h later, `wikipedia_only_24h`, for a decided fight
 * with no other source).
 *
 * Idempotent: `processScheduleEvent` -> `upsertFight` matches the existing
 * row by external_id or fighter pair and UPDATEs its per-source columns;
 * it never inserts a duplicate for a card that already has rows. A Wikipedia
 * error on one card is caught and logged, never aborting the sync.
 */
export async function refreshRecentEventResults(
  supabase: SupabaseClient,
  opts: { dryRun?: boolean; today?: string; windowDays?: number } = {},
): Promise<RefreshRecentResultsSummary> {
  const dryRun = opts.dryRun ?? false;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const windowDays = opts.windowDays ?? REFRESH_WINDOW_DAYS;
  const earliest = windowFloor(today, windowDays);

  const eventRows = await selectAllPages<EventRow>(
    supabase,
    "events",
    "id, external_id, event_date, merged_into",
    (q) => q.gte("event_date", earliest).lt("event_date", today).is("merged_into", null),
  );

  const summary: RefreshRecentResultsSummary = {
    windowEarliest: earliest,
    candidateTitles: [],
    eventsRefreshed: 0,
    fightsTouched: 0,
    failed: 0,
    dryRun,
  };

  if (eventRows.length === 0) return summary;

  const windowEventIds = eventRows.map((e) => e.id);
  const fightRows = await selectAllPages<FightResultRow>(
    supabase,
    "fights",
    "id, event_id, wikipedia_reported_at",
    (q) => q.in("event_id", windowEventIds),
  );
  const eventIdsWithUnreportedFight = new Set(
    fightRows.filter((f) => f.wikipedia_reported_at === null).map((f) => f.event_id),
  );

  const candidates: RefreshCandidateEvent[] = eventRows.map((e) => ({
    id: e.id,
    externalId: e.external_id,
    eventDate: e.event_date,
    mergedInto: e.merged_into,
  }));
  const titles = selectEventsNeedingResultRefresh(candidates, eventIdsWithUnreportedFight, {
    earliest,
    today,
  });
  summary.candidateTitles = titles;

  if (dryRun || titles.length === 0) return summary;

  for (const title of titles) {
    try {
      await sleep(WIKI_REQUEST_SPACING_MS);
      const event = await fetchEventSchedule(title);
      if (!event.date || event.bouts.length === 0) continue;
      const result = await processScheduleEvent(supabase, title, event);
      summary.eventsRefreshed++;
      summary.fightsTouched += result.fightCount;
    } catch (err) {
      summary.failed++;
      console.error(`Recent-results refresh failed for "${title}":`, err);
    }
  }

  return summary;
}
