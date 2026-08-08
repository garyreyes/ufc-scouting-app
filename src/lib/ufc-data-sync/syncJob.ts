import { createClient } from "@supabase/supabase-js";
import { fetchFightHistory, type FightHistoryEntry } from "./fetchFightHistory";
import { fetchFighter } from "./fetchFighter";

// The API only supports per-date lookups, not date ranges or bulk history.
// The free plan additionally only allows a rolling ~3-day window whose
// exact boundary doesn't line up cleanly with UTC "today" (timezone quirk
// on the API's side) -- so dates outside it are skipped per-date below
// rather than relied on to fall inside a computed range. See CHANGES.md
// Phase 5: on the free plan there's no way to reach upcoming or older
// fights at all, only this narrow near-today window.
const WINDOW_DAYS_PAST = 3;
const WINDOW_DAYS_FUTURE = 1;

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  // service role bypasses RLS -- this must only ever run server-side.
  return createClient(url, serviceRoleKey);
}

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

  const eventsBySlug = new Map<string, { external_id: string; name: string; event_date: string }>();
  for (const entry of entries) {
    if (!eventsBySlug.has(entry.eventSlug)) {
      eventsBySlug.set(entry.eventSlug, {
        external_id: entry.eventSlug,
        name: entry.eventSlug,
        event_date: entry.eventDate,
      });
    }
  }
  const { data: upsertedEvents, error: eventsError } = await supabase
    .from("events")
    .upsert(Array.from(eventsBySlug.values()), { onConflict: "external_id" })
    .select("id, external_id");
  if (eventsError) throw eventsError;
  const eventIdBySlug = new Map(upsertedEvents.map((e) => [e.external_id, e.id]));

  const fighterExternalIds = new Set<string>();
  for (const entry of entries) {
    fighterExternalIds.add(entry.fighter1ExternalId);
    fighterExternalIds.add(entry.fighter2ExternalId);
  }
  const fighterRows = [];
  for (const externalId of fighterExternalIds) {
    const fighter = await fetchFighter(Number(externalId));
    if (fighter) fighterRows.push(fighter);
  }
  const { data: upsertedFighters, error: fightersError } = await supabase
    .from("fighters")
    .upsert(fighterRows, { onConflict: "external_id" })
    .select("id, external_id");
  if (fightersError) throw fightersError;
  const fighterIdByExternalId = new Map(upsertedFighters.map((f) => [f.external_id, f.id]));

  const fightRows = entries.map((entry) => ({
    external_id: entry.externalFightId,
    event_id: eventIdBySlug.get(entry.eventSlug),
    fighter1_id: fighterIdByExternalId.get(entry.fighter1ExternalId),
    fighter2_id: fighterIdByExternalId.get(entry.fighter2ExternalId),
    winner_id: entry.winnerExternalId
      ? fighterIdByExternalId.get(entry.winnerExternalId)
      : null,
    weight_class: entry.weightClass,
  }));
  const { error: fightsError } = await supabase
    .from("fights")
    .upsert(fightRows, { onConflict: "external_id" });
  if (fightsError) throw fightsError;

  console.log(
    `Synced ${eventsBySlug.size} events, ${fighterRows.length} fighters, ${fightRows.length} fights.`,
  );
}

runSyncJob().catch((err) => {
  console.error(err);
  process.exit(1);
});
