import type { SupabaseClient } from "@supabase/supabase-js";
import { BlueskyAuthError } from "../bluesky";
import { scanFightForRumours } from "./scanFightForRumours";
import type { FightToScan } from "./scanFightForRumours";

export interface RumourScanSummary {
  eventId: string | null;
  fightsScanned: number;
  llmFights: number;
  heuristicFallbackFights: number;
  skippedNoPosts: number;
  failedFights: number;
  flagsWritten: number;
  sourcesWritten: number;
}

interface EmbeddedFight {
  id: string;
  fighter1: { id: string; name: string };
  fighter2: { id: string; name: string };
}

async function fetchNearestUpcomingEventFights(
  supabase: SupabaseClient,
): Promise<{ eventId: string | null; fights: FightToScan[] }> {
  const today = new Date().toISOString().slice(0, 10);

  // Same shape as features/fights/api.ts's getUpcomingEvents, scoped to
  // just the soonest one -- UC-1's own framing is "before a card, I open
  // an event," and one card's worth of fighters (~12-15) keeps every run
  // comfortably inside Gemini's free-tier daily budget (lib/llm.ts).
  const { data: events, error: eventsError } = await supabase
    .from("events")
    .select("id")
    .gte("event_date", today)
    .order("event_date", { ascending: true })
    .limit(1);
  if (eventsError) throw eventsError;

  const event = events?.[0] as { id: string } | undefined;
  if (!event) return { eventId: null, fights: [] };

  const { data: fights, error: fightsError } = await supabase
    .from("fights")
    .select("id, fighter1:fighter1_id(id, name), fighter2:fighter2_id(id, name)")
    .eq("event_id", event.id);
  if (fightsError) throw fightsError;

  return {
    eventId: event.id,
    fights: ((fights ?? []) as unknown as EmbeddedFight[]).map((f) => ({
      id: f.id,
      fighter1: f.fighter1,
      fighter2: f.fighter2,
    })),
  };
}

/**
 * The actual work behind the scheduled cron (runScheduledRumourJob.ts).
 * Each fight is scanned independently and a per-fight failure (a Bluesky
 * or Gemini network blip) does not abort the rest of the card -- unlike
 * matchAndSnapshot.ts's loop, this one makes a real external network call
 * per iteration, so losing 14 fights' worth of real scouting data to one
 * transient failure would be a disproportionate way to fail. If every
 * single fight failed, that's no longer a transient blip -- the whole
 * job throws so runWithTracking (caller) records a real job_runs failure
 * rather than a falsely "successful" run that wrote nothing.
 */
export async function runRumourScanJob(supabase: SupabaseClient): Promise<RumourScanSummary> {
  const { eventId, fights } = await fetchNearestUpcomingEventFights(supabase);

  const summary: RumourScanSummary = {
    eventId,
    fightsScanned: 0,
    llmFights: 0,
    heuristicFallbackFights: 0,
    skippedNoPosts: 0,
    failedFights: 0,
    flagsWritten: 0,
    sourcesWritten: 0,
  };

  for (const fight of fights) {
    try {
      const result = await scanFightForRumours(supabase, fight);
      summary.fightsScanned++;
      if (result.mode === "llm") summary.llmFights++;
      else if (result.mode === "heuristic") summary.heuristicFallbackFights++;
      else summary.skippedNoPosts++;
      summary.flagsWritten += result.flagsWritten;
      summary.sourcesWritten += result.sourcesWritten;
    } catch (err) {
      // A Bluesky auth failure (rate limit or bad credentials) is
      // card-wide, not one fight's bad luck -- every remaining fight would
      // hit the same wall, and bluesky.ts's post-failure cooldown means
      // they would all fail without even a network call. Abort now so the
      // job fails fast with one clear error instead of 14 identical ones,
      // and so the run makes exactly one createSession attempt.
      if (err instanceof BlueskyAuthError) throw err;
      summary.failedFights++;
      console.error(`Rumour scan failed for fight ${fight.id}:`, err);
    }
  }

  if (fights.length > 0 && summary.failedFights === fights.length) {
    throw new Error(`Rumour scan failed for every fight on event ${eventId} (${fights.length}/${fights.length}).`);
  }

  return summary;
}
