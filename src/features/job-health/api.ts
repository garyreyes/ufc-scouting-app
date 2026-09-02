import { supabase } from "@/lib/db";
import { fetchEligibleUnpricedFights } from "@/lib/odds/eligibleUnpricedFights";
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
