import type { SupabaseClient } from "@supabase/supabase-js";
import { runWithTracking } from "../jobs/runWithTracking";
import { fetchMmaOdds } from "./client";
import { discoverStartTimes } from "./discoverStartTimes";
import { matchAndSnapshot, type MatchAndSnapshotSummary } from "./matchAndSnapshot";
import type { DiscoverStartTimesSummary } from "./discoverStartTimes";

export interface OddsJobsSummary {
  discovery: DiscoverStartTimesSummary;
  snapshot: MatchAndSnapshotSummary;
}

/**
 * The actual work behind both B5 entry points: the scheduled cron
 * (runScheduledOddsJob.ts) and the owner's manual "retry now" action
 * (features/job-health/actions.ts) call this exact function, so a manual
 * retry is never a second, divergent code path -- it is the same job, run
 * on demand. One shared fetchMmaOdds() call feeds both tracked jobs; see
 * runScheduledOddsJob.ts for why that sharing matters for the API budget.
 *
 * This is also what makes "manual late pull, accepting the worse price"
 * (ROADMAP.md B5, docs/PRD.md) work with no special-casing: a "missed"
 * card is by definition already past its T-12h window, so
 * matchAndSnapshot's own gate already treats it as eligible -- calling
 * this again simply prices it against whatever the feed returns right
 * now, which is the later, worse price by construction.
 *
 * If the shared fetch itself fails, both tracked jobs are recorded as
 * failed against the same underlying error rather than left with no row
 * at all -- see logSharedFetchFailure below.
 */
export async function runOddsJobsOnce(supabase: SupabaseClient): Promise<OddsJobsSummary> {
  const startedAt = new Date().toISOString();

  let oddsEvents: Awaited<ReturnType<typeof fetchMmaOdds>>;
  try {
    oddsEvents = await fetchMmaOdds();
  } catch (err) {
    await logSharedFetchFailure(supabase, startedAt, err);
    throw err;
  }

  const discovery = await runWithTracking(supabase, "discover_start_times", () =>
    discoverStartTimes(supabase, oddsEvents),
  );
  const snapshot = await runWithTracking(supabase, "odds_snapshot", () =>
    matchAndSnapshot(supabase, oddsEvents),
  );

  return { discovery, snapshot };
}

async function logSharedFetchFailure(
  supabase: SupabaseClient,
  startedAt: string,
  err: unknown,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const finishedAt = new Date().toISOString();
  for (const jobName of ["discover_start_times", "odds_snapshot"]) {
    try {
      await supabase.from("job_runs").insert({
        job_name: jobName,
        status: "failure",
        started_at: startedAt,
        finished_at: finishedAt,
        error: `shared odds fetch failed: ${message}`,
      });
    } catch {
      // Best effort -- the caller's own failure path (process exit or a
      // thrown error back to the server action) is the other half of
      // "loud" regardless of whether this logging succeeds.
    }
  }
}
