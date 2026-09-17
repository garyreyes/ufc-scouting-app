import type { SupabaseClient } from "@supabase/supabase-js";
import { BlueskyAuthError } from "../bluesky";
import { fetchNearestUpcomingEventId } from "../events/nearestUpcomingEvent";
import { createMapReduceDeps } from "../llm/createMapReduceDeps";
import { describeDegradation } from "../llm/describeDegradation";
import { proposeCardRetractions } from "./proposeCardRetractions";
import { scanFightForRumours } from "./scanFightForRumours";
import type { FightToScan } from "./scanFightForRumours";
import type { CandidatePost } from "./types";

export interface RumourScanSummary {
  eventId: string | null;
  fightsScanned: number;
  llmFights: number;
  heuristicFallbackFights: number;
  skippedNoPosts: number;
  failedFights: number;
  flagsWritten: number;
  sourcesWritten: number;
  // Phase N3: the card-level retraction pass, run once after every fight
  // has been scanned. `retractionFailed` is deliberately separate from
  // `failedFights` above -- a retraction failure never invalidates this
  // run's real clustering work, so it must never count toward the
  // "every fight failed" abort check below.
  proposedRetractions: number;
  flagsRetracted: number;
  retractionFailed: boolean;
}

interface EmbeddedFight {
  id: string;
  fighter1: { id: string; name: string };
  fighter2: { id: string; name: string };
}

async function fetchNearestUpcomingEventFights(
  supabase: SupabaseClient,
): Promise<{ eventId: string | null; fights: FightToScan[] }> {
  // The soonest not-yet-happened card -- one card's worth of fighters
  // (~12-15) keeps every run comfortably inside Gemini's free-tier daily
  // budget (lib/llm.ts). Shared with the intern job since Phase L1.
  const eventId = await fetchNearestUpcomingEventId(supabase);
  if (eventId === null) return { eventId: null, fights: [] };

  // M2: `.is("settled_at", null)` -- a cancelled bout has no upcoming
  // fight to scan rumours about.
  const { data: fights, error: fightsError } = await supabase
    .from("fights")
    .select("id, fighter1:fighter1_id(id, name), fighter2:fighter2_id(id, name)")
    .eq("event_id", eventId)
    .is("settled_at", null);
  if (fightsError) throw fightsError;

  return {
    eventId,
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
    proposedRetractions: 0,
    flagsRetracted: 0,
    retractionFailed: false,
  };

  // Deduped the same way collectCandidatePosts (inside
  // scanFightForRumours.ts) dedupes within one fight -- a post naming
  // fighters from two different bouts on the same card would otherwise
  // appear twice in the retraction prompt.
  const cardPostsByUri = new Map<string, CandidatePost>();

  for (const fight of fights) {
    try {
      const result = await scanFightForRumours(supabase, fight);
      summary.fightsScanned++;
      if (result.mode === "llm") summary.llmFights++;
      else if (result.mode === "heuristic") summary.heuristicFallbackFights++;
      else summary.skippedNoPosts++;
      summary.flagsWritten += result.flagsWritten;
      summary.sourcesWritten += result.sourcesWritten;
      for (const post of result.candidatePosts) cardPostsByUri.set(post.uri, post);
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

  // Phase N3: one card-level pass, after every fight's own scan, proposing
  // retractions for flags the real evidence has moved past. Isolated in
  // its own try/catch -- unlike a Bluesky auth failure above, a bug here
  // must never invalidate the real clustering work this run already did
  // and already wrote.
  if (fights.length > 0) {
    try {
      const retractionResult = await proposeCardRetractions(
        supabase,
        createMapReduceDeps(supabase),
        fights,
        [...cardPostsByUri.values()],
      );
      summary.proposedRetractions = retractionResult.proposedRetractions;
      summary.flagsRetracted = retractionResult.flagsRetracted;
      const warning = describeDegradation(retractionResult.degradation);
      if (warning) console.warn(`Degraded (retraction pass): ${warning}`);
    } catch (err) {
      summary.retractionFailed = true;
      console.error("Retraction pass failed:", err);
    }
  }

  return summary;
}
