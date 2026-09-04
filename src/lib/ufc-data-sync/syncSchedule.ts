import { listUpcomingUfcEventTitles, fetchEventSchedule } from "./fetchSchedule";
import { getSupabaseAdmin } from "../supabase/admin";
import { processScheduleEvent } from "./processScheduleEvent";

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
}

runScheduleSync().catch((err) => {
  console.error(err);
  process.exit(1);
});
