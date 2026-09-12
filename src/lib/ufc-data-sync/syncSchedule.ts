import { listUpcomingUfcEventTitles, fetchEventSchedule } from "./fetchSchedule";
import { getSupabaseAdmin } from "../supabase/admin";
import { processScheduleEvent } from "./processScheduleEvent";
import { mergeDuplicateSameDateEvents } from "./mergeDuplicateSameDateEvents";
import { refreshRecentEventResults } from "./refreshRecentEventResults";

export async function runScheduleSync() {
  const supabase = getSupabaseAdmin();
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
  try {
    const refresh = await refreshRecentEventResults(supabase);
    if (refresh.candidateTitles.length > 0) {
      console.log(
        `Recent-results refresh: ${refresh.eventsRefreshed}/${refresh.candidateTitles.length} cards refreshed, ` +
          `${refresh.fightsTouched} fight rows touched, ${refresh.failed} failed.`,
      );
    }
  } catch (err) {
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
}

runScheduleSync().catch((err) => {
  console.error(err);
  process.exit(1);
});
