import { listUpcomingUfcEventTitles, fetchEventSchedule } from "./fetchSchedule";
import { getSupabaseAdmin } from "../supabase/admin";
import { upsertFighter } from "./upsertFighter";
import { upsertEvent } from "./upsertEvent";
import { upsertFight } from "./upsertFight";

export async function runScheduleSync() {
  const supabase = getSupabaseAdmin();
  const titles = await listUpcomingUfcEventTitles();

  let eventCount = 0;
  let fightCount = 0;

  for (const title of titles) {
    const event = await fetchEventSchedule(title);
    if (!event.date || event.bouts.length === 0) continue;

    const eventId = await upsertEvent(supabase, {
      external_id: title,
      name: title,
      event_date: event.date,
    });
    eventCount++;

    for (const [index, bout] of event.bouts.entries()) {
      const fighter1Id = await upsertFighter(supabase, { name: bout.fighter1Name });
      const fighter2Id = await upsertFighter(supabase, { name: bout.fighter2Name });
      // fetchEventSchedule only ever reports fighter1 as the winner (the
      // wiki template lists winner first: "Winner | def. | Loser").
      const winnerId = bout.winnerName ? fighter1Id : null;

      // upsertFight falls back to matching on (event, unordered fighter
      // pair), so this merges into a fight syncJob.ts already created
      // from API-Sports instead of leaving one bout as two rows.
      await upsertFight(supabase, {
        external_id: `wiki:${title}:${index}`,
        event_id: eventId,
        fighter1_id: fighter1Id,
        fighter2_id: fighter2Id,
        winner_id: winnerId,
        method: bout.method,
        round: bout.round,
        weight_class: bout.weightClass,
      });
      fightCount++;
    }
  }

  console.log(`Schedule sync (Wikipedia): ${eventCount} events, ${fightCount} fights.`);
}

runScheduleSync().catch((err) => {
  console.error(err);
  process.exit(1);
});
