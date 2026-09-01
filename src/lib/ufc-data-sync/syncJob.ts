import { fetchFightHistory, type FightHistoryEntry } from "./fetchFightHistory";
import { fetchFighter } from "./fetchFighter";
import { getSupabaseAdmin } from "../supabase/admin";
import { upsertFighter } from "./upsertFighter";
import { upsertEvent } from "./upsertEvent";
import { upsertFight } from "./upsertFight";

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

  const uniqueEvents = new Map<string, { external_id: string; name: string; event_date: string }>();
  for (const entry of entries) {
    if (!uniqueEvents.has(entry.eventSlug)) {
      uniqueEvents.set(entry.eventSlug, {
        external_id: entry.eventSlug,
        name: entry.eventSlug,
        event_date: entry.eventDate,
      });
    }
  }
  const eventIdBySlug = new Map<string, string>();
  for (const [slug, event] of uniqueEvents) {
    // upsertEvent falls back to a punctuation-insensitive name match, so
    // this merges into an event syncSchedule.ts already created from
    // Wikipedia instead of creating a near-duplicate row.
    eventIdBySlug.set(slug, await upsertEvent(supabase, event));
  }

  const fighterExternalIds = new Set<string>();
  for (const entry of entries) {
    fighterExternalIds.add(entry.fighter1ExternalId);
    fighterExternalIds.add(entry.fighter2ExternalId);
  }
  const fighterIdByExternalId = new Map<string, string>();
  let fighterCount = 0;
  for (const externalId of fighterExternalIds) {
    const fighter = await fetchFighter(Number(externalId));
    if (!fighter) continue;
    // upsertFighter matches by external_id first, falling back to an
    // exact name match -- so a fighter created earlier as a Wikipedia
    // placeholder (no external_id) gets updated in place here instead
    // of duplicated.
    const id = await upsertFighter(supabase, fighter);
    fighterIdByExternalId.set(externalId, id);
    fighterCount++;
  }

  let fightCount = 0;
  for (const entry of entries) {
    const eventId = eventIdBySlug.get(entry.eventSlug);
    const fighter1Id = fighterIdByExternalId.get(entry.fighter1ExternalId);
    const fighter2Id = fighterIdByExternalId.get(entry.fighter2ExternalId);
    if (!eventId || !fighter1Id || !fighter2Id) continue;

    // upsertFight falls back to matching on (event, unordered fighter
    // pair), so this merges into a fight syncSchedule.ts already created
    // from Wikipedia instead of leaving one bout as two rows.
    await upsertFight(supabase, {
      external_id: entry.externalFightId,
      event_id: eventId,
      fighter1_id: fighter1Id,
      fighter2_id: fighter2Id,
      source: "api_sports",
      winner_id: entry.winnerExternalId
        ? fighterIdByExternalId.get(entry.winnerExternalId)
        : null,
      weight_class: entry.weightClass,
    });
    fightCount++;
  }

  console.log(
    `Synced ${uniqueEvents.size} events, ${fighterCount} fighters, ${fightCount} fights.`,
  );
}

runSyncJob().catch((err) => {
  console.error(err);
  process.exit(1);
});
