import type { SupabaseClient } from "@supabase/supabase-js";
import type { FightHistoryEntry } from "./fetchFightHistory";
import { fetchFighter } from "./fetchFighter";
import { upsertFighter } from "./upsertFighter";
import { upsertEvent } from "./upsertEvent";
import { upsertFight } from "./upsertFight";

export interface ProcessFightHistoryResult {
  eventCount: number;
  fighterCount: number;
  fightCount: number;
}

/**
 * The actual event/fighter/fight upsert sequence -- extracted from
 * syncJob.ts (I3) once a second caller (backfillFightHistory.ts) needed
 * the identical three-phase resolution: dedupe events, dedupe and
 * enrich fighters, then upsert each fight against the now-resolved ids.
 * syncJob.ts's own recent-results sync is unchanged in behaviour, just
 * no longer duplicating this logic.
 *
 * Every fighter appearing in `entries` gets (re-)fetched and (re-)upserted,
 * not just new opponents -- same as syncJob.ts always did for any
 * fighter in its window. Harmless: upsertFighter merges via
 * stripNullish, so re-syncing an already-enriched fighter never blanks
 * anything, and it's what keeps a fighter's record current if API-Sports
 * itself updated something.
 */
export async function processFightHistoryEntries(
  supabase: SupabaseClient,
  entries: FightHistoryEntry[],
): Promise<ProcessFightHistoryResult> {
  if (entries.length === 0) return { eventCount: 0, fighterCount: 0, fightCount: 0 };

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

    await upsertFight(supabase, {
      external_id: entry.externalFightId,
      event_id: eventId,
      fighter1_id: fighter1Id,
      fighter2_id: fighter2Id,
      source: "api_sports",
      winner_id: entry.winnerExternalId ? fighterIdByExternalId.get(entry.winnerExternalId) : null,
      weight_class: entry.weightClass,
    });
    fightCount++;
  }

  return { eventCount: uniqueEvents.size, fighterCount, fightCount };
}
