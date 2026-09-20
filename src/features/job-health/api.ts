import { supabase } from "@/lib/db";
import { fetchEligibleUnpricedFights, fetchPricedFightIds } from "@/lib/odds/eligibleUnpricedFights";
import { fetchNearestUpcomingEventId } from "@/lib/events/nearestUpcomingEvent";
import { getOpenDisputedFightIds, getOpenLowConfidenceCandidateFightIds } from "@/features/conflicts/api";
import { buildCardReadiness, type CardReadiness } from "@/lib/cardReadiness/buildCardReadiness";
import type { JobRunRow } from "@/shared/utils/evaluateJobHealth";

// The two job_runs job_name values written by runScheduledOddsJob.ts
// (B5). Deliberately NOT joined by "rumour_scan" (F2/F3) -- decided in
// F3: this banner is global app-shell chrome with odds-specific wording
// ("Odds job degraded"), but rumour flags only ever appear on
// /events/[id] and /fights/[id], so a site-wide banner for it (e.g. on
// /fighters) would be irrelevant chrome. features/rumours/api.ts's
// getRumourScanHealth + RumourHealthNotice cover the equivalent state
// as a separate, page-scoped notice instead, reusing evaluateJobHealth
// (shared/utils/) rather than this list.
export const TRACKED_JOB_NAMES = ["discover_start_times", "odds_snapshot"] as const;

/**
 * The latest row per tracked job, for the health banner. PostgREST has no
 * native "distinct on job_name", so this fetches each tracked job's own
 * latest row directly rather than pulling full history and reducing it
 * client-side -- cheap at this scale (two tiny queries) and avoids an
 * unbounded table scan growing linearly with every job_runs row ever
 * written.
 */
export async function getLatestJobRuns(): Promise<JobRunRow[]> {
  const rows = await Promise.all(
    TRACKED_JOB_NAMES.map(async (jobName) => {
      const { data, error } = await supabase
        .from("job_runs")
        .select("job_name, status, finished_at, error")
        .eq("job_name", jobName)
        .order("finished_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    }),
  );

  return rows
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .map((row) => ({
      jobName: row.job_name as string,
      status: row.status as "success" | "failure",
      finishedAt: row.finished_at as string,
      error: row.error as string | null,
    }));
}

/**
 * Count of fights past their T-12h window with no price yet -- the
 * outcome-based half of evaluateJobHealth's signal. Known simplification:
 * this doesn't cross-reference data_conflicts, so a fight already queued
 * there as low_confidence_odds_match still counts here too. B6's
 * /conflicts screen is the real home for that distinction; refining this
 * count to exclude already-queued fights belongs there, once data_
 * conflicts has a read policy for the owner to actually query it against
 * (it currently has none -- see 0014_data_conflicts.sql).
 */
export async function getMissedSnapshotCount(now: Date = new Date()): Promise<number> {
  const fights = await fetchEligibleUnpricedFights(supabase, now);
  return fights.length;
}

/**
 * P9 (ROADMAP_V2.md Phase P): the pre-card number, for the single
 * nearest upcoming event -- extends this feature's existing job-health
 * surface into a real data-integrity panel rather than a second parallel
 * system. Returns null when there's no upcoming card at all (the "no
 * card this week" empty state, docs/PRD.md) -- callers must not render a
 * 0/0 panel in that case, since that reads as "nothing to worry about"
 * rather than "nothing to show."
 *
 * events/fights/fighters are public-read (0002_grants.sql) so this uses
 * the plain client for those; data_conflicts has no client grant at all,
 * so the two conflict lookups go through conflicts/api.ts's admin-gated
 * helpers instead (see that file's own docstring on why).
 */
export async function getCardReadiness(now: Date = new Date()): Promise<CardReadiness | null> {
  const eventId = await fetchNearestUpcomingEventId(supabase);
  if (!eventId) return null;

  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("name, event_date")
    .eq("id", eventId)
    .single();
  if (eventError) throw eventError;

  const { data: fights, error: fightsError } = await supabase
    .from("fights")
    .select("id, fighter1_id, fighter2_id")
    .eq("event_id", eventId);
  if (fightsError) throw fightsError;
  const fightRows = fights ?? [];
  const fightIds = fightRows.map((f) => f.id as string);
  const fighterIds = [...new Set(fightRows.flatMap((f) => [f.fighter1_id, f.fighter2_id] as string[]))];

  const [pricedFightIds, sherdogRows, disputedFightIds, lowConfidenceFightIds] = await Promise.all([
    fetchPricedFightIds(supabase),
    supabase.from("fighters").select("id, sherdog_checked_at").in("id", fighterIds).then(({ data, error }) => {
      if (error) throw error;
      return data ?? [];
    }),
    getOpenDisputedFightIds(fightIds),
    getOpenLowConfidenceCandidateFightIds(fightIds),
  ]);

  const sherdogCheckedFighterIds = new Set(
    sherdogRows.filter((f) => f.sherdog_checked_at !== null).map((f) => f.id as string),
  );
  const openConflictCount = new Set([...disputedFightIds, ...lowConfidenceFightIds]).size;

  return buildCardReadiness(
    {
      eventName: event.name as string,
      eventDate: event.event_date as string,
      fightIds,
      fighterIds,
      pricedFightIds,
      sherdogCheckedFighterIds,
      openConflictCount,
    },
    now,
  );
}
