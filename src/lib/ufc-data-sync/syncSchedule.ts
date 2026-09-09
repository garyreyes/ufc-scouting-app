import { listUpcomingUfcEventTitles, fetchEventSchedule } from "./fetchSchedule";
import { getSupabaseAdmin } from "../supabase/admin";
import { processScheduleEvent } from "./processScheduleEvent";
import { mergeDuplicateSameDateEvents } from "./mergeDuplicateSameDateEvents";

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
