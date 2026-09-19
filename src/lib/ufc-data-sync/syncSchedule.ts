import type { SupabaseClient } from "@supabase/supabase-js";
import { listUpcomingUfcEventTitles, fetchEventSchedule } from "./fetchSchedule";
import { getSupabaseAdmin } from "../supabase/admin";
import { processScheduleEvent } from "./processScheduleEvent";
import { mergeDuplicateSameDateEvents } from "./mergeDuplicateSameDateEvents";
import { refreshRecentEventResults } from "./refreshRecentEventResults";
import { runWithTracking } from "../jobs/runWithTracking";

export interface ScheduleSyncSummary {
  eventCount: number;
  fightCount: number;
  refreshCandidates: number;
  refreshed: number;
  refreshFightsTouched: number;
  refreshFailed: number;
  // Set only when the refresh step's own initial reads failed (caught,
  // not let propagate -- see the try/catch below); null on a normal run.
  refreshError: string | null;
  mergeClustersMerged: number;
  mergeFightsDeleted: number;
  // K1-followup (2026-09-19): full skip detail, not just a count -- this
  // is the only durable record of a K1 skip now that this whole function
  // is wrapped in `runWithTracking` below. Previously console-only, so a
  // skip that happened on a scheduled run (as opposed to a manual
  // `npm run events:merge-duplicates`) left no trace anywhere queryable.
  mergeSkipped: { event_date: string; eventIds: string[]; reason: string }[];
}

export async function runScheduleSync(supabase: SupabaseClient): Promise<ScheduleSyncSummary> {
  const titles = await listUpcomingUfcEventTitles();

  let eventCount = 0;
  let fightCount = 0;

  for (const title of titles) {
    const event = await fetchEventSchedule(title);
    if (!event.date || event.bouts.length === 0) continue;

    // upsertEvent / upsertFighter / upsertFight all fall back to name- or
    // fighter-pair matching, so this merges into rows syncJob.ts already
    // created from API-Sports instead of leaving one bout as two.
    const result = await processScheduleEvent(supabase, title, event);
    eventCount++;
    fightCount += result.fightCount;
  }

  console.log(`Schedule sync (Wikipedia): ${eventCount} events, ${fightCount} fights.`);

  // L2: a card leaves Category:Scheduled ~when it finishes, so the loop
  // above stops covering it exactly when its results appear. Re-pull the
  // last ~30 days of finished cards here so their wikipedia_* result
  // columns get written -- sync.yml runs settlement immediately after
  // this, so a freshly-pulled result settles the same run.
  //
  // Caught, not let propagate: a per-card Wikipedia error is already
  // handled inside refreshRecentEventResults itself, but a failure in its
  // own initial reads (events/fights) must not skip the duplicate-event
  // merge below, which is otherwise unrelated (reviewer finding, L2b).
  let refreshCandidates = 0;
  let refreshed = 0;
  let refreshFightsTouched = 0;
  let refreshFailed = 0;
  let refreshError: string | null = null;
  try {
    const refresh = await refreshRecentEventResults(supabase);
    refreshCandidates = refresh.candidateTitles.length;
    refreshed = refresh.eventsRefreshed;
    refreshFightsTouched = refresh.fightsTouched;
    refreshFailed = refresh.failed;
    if (refresh.candidateTitles.length > 0) {
      console.log(
        `Recent-results refresh: ${refresh.eventsRefreshed}/${refresh.candidateTitles.length} cards refreshed, ` +
          `${refresh.fightsTouched} fight rows touched, ${refresh.failed} failed.`,
      );
    }
  } catch (err) {
    refreshError = err instanceof Error ? err.message : String(err);
    console.error("Recent-results refresh failed -- continuing sync without it:", err);
  }

  // A source renaming a card (or the two sources naming it differently)
  // leaves one real event as two rows that upsertEvent.ts can't fold --
  // consolidate them now that every event this run has been written.
  const merge = await mergeDuplicateSameDateEvents(supabase);
  if (merge.duplicateClustersMerged > 0 || merge.skipped.length > 0) {
    console.log(
      `Duplicate-event merge: ${merge.duplicateClustersMerged} merged, ` +
        `${merge.fightsDeleted} duplicate fights removed, ${merge.skipped.length} skipped (manual review).`,
    );
    for (const cluster of merge.skipped) {
      console.log(`  Skipped ${cluster.event_date} [${cluster.eventIds.join(", ")}]: ${cluster.reason}`);
    }
  }

  return {
    eventCount,
    fightCount,
    refreshCandidates,
    refreshed,
    refreshFightsTouched,
    refreshFailed,
    refreshError,
    mergeClustersMerged: merge.duplicateClustersMerged,
    mergeFightsDeleted: merge.fightsDeleted,
    mergeSkipped: merge.skipped,
  };
}

// K1-followup (2026-09-19): this was the one scheduled job in the
// codebase NOT wrapped in `runWithTracking` -- every other job (odds,
// rumours, intern) writes a `job_runs` row on every run; this one wrote
// none at all, skip or no skip. Matches the same thin
// main()-calls-runWithTracking(jobFn(supabase)) shape every other
// `runScheduled*Job.ts` entry point already uses.
async function main() {
  const supabase = getSupabaseAdmin();
  const summary = await runWithTracking(supabase, "sync_schedule", () => runScheduleSync(supabase));

  if (summary.mergeSkipped.length > 0) {
    console.warn(`Degraded: ${summary.mergeSkipped.length} duplicate-event cluster(s) skipped -- manual review.`);
  }
  if (summary.refreshError) {
    console.warn(`Degraded: recent-results refresh failed this run: ${summary.refreshError}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
