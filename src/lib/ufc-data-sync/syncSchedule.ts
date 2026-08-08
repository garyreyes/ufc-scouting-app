import { listUpcomingUfcEventTitles, fetchEventSchedule } from "./fetchSchedule";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { upsertFighter } from "./upsertFighter";
import { upsertEvent } from "./upsertEvent";

// Fights sourced here use a synthetic external_id ("wiki:UFC 331:0")
// rather than API-Sports' numeric ids, since those don't exist yet for
// fights this far out. When the date later rolls into API-Sports'
// reachable window, syncJob.ts's run creates a *separate* fight row keyed
// by the real external_id -- individual fights are not merged across the
// two sources (events are, via upsertEvent; fighters are, via
// upsertFighter). Known limitation, not yet solved.
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

      const fightExternalId = `wiki:${title}:${index}`;
      const fightRow = {
        external_id: fightExternalId,
        event_id: eventId,
        fighter1_id: fighter1Id,
        fighter2_id: fighter2Id,
        winner_id: winnerId,
        method: bout.method,
        round: bout.round,
        weight_class: bout.weightClass,
      };

      const { data: existingFight, error: findFightError } = await supabase
        .from("fights")
        .select("id")
        .eq("external_id", fightExternalId)
        .maybeSingle();
      if (findFightError) throw findFightError;

      const { error: writeError } = existingFight
        ? await supabase.from("fights").update(fightRow).eq("id", existingFight.id)
        : await supabase.from("fights").insert(fightRow);
      if (writeError) throw writeError;

      fightCount++;
    }
  }

  console.log(`Schedule sync (Wikipedia): ${eventCount} events, ${fightCount} fights.`);
}

runScheduleSync().catch((err) => {
  console.error(err);
  process.exit(1);
});
