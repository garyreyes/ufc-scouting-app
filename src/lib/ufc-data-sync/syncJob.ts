import { fetchFightHistory, type FightHistoryEntry } from "./fetchFightHistory";
import { getSupabaseAdmin } from "../supabase/admin";
import { processFightHistoryEntries } from "./processFightHistoryEntries";

// The API only supports per-date lookups, not date ranges or bulk history.
// The free plan additionally only allows a rolling ~3-day window whose
// exact boundary doesn't line up cleanly with UTC "today" (timezone quirk
// on the API's side) -- so dates outside it are skipped per-date below
// rather than relied on to fall inside a computed range. See CHANGES.md
// Phase 5: on the free plan there's no way to reach upcoming or older
// fights at all, only this narrow near-today window. syncSchedule.ts
// covers upcoming fights instead, via Wikipedia.
const WINDOW_DAYS_PAST = 3;
const WINDOW_DAYS_FUTURE = 1;

function dateRange(pastDays: number, futureDays: number): string[] {
  const dates: string[] = [];
  const today = new Date();
  for (let offset = -pastDays; offset <= futureDays; offset++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + offset);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

export async function runSyncJob() {
  const supabase = getSupabaseAdmin();
  const dates = dateRange(WINDOW_DAYS_PAST, WINDOW_DAYS_FUTURE);

  const entries: FightHistoryEntry[] = [];
  for (const date of dates) {
    try {
      entries.push(...(await fetchFightHistory(date)));
    } catch (err) {
      console.warn(`Skipping ${date}: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (entries.length === 0) {
    console.log("No UFC fights found in sync window.");
    return;
  }

  // upsertEvent falls back to a punctuation-insensitive name match (merges
  // into a Wikipedia-created event), upsertFighter falls back to an
  // exact-after-fold name match (merges into a Wikipedia-created
  // placeholder), and upsertFight falls back to an unordered fighter-pair
  // match -- so this never creates duplicates of rows syncSchedule.ts
  // already wrote.
  const result = await processFightHistoryEntries(supabase, entries);

  console.log(
    `Synced ${result.eventCount} events, ${result.fighterCount} fighters, ${result.fightCount} fights.`,
  );
}

runSyncJob().catch((err) => {
  console.error(err);
  process.exit(1);
});
