import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScheduledEvent } from "./fetchSchedule";
import { buildWikiFightExternalId } from "./buildWikiFightExternalId";
import { upsertEvent } from "./upsertEvent";
import { upsertFighter } from "./upsertFighter";
import { upsertFight } from "./upsertFight";

export interface ProcessScheduleEventResult {
  eventId: string;
  fightCount: number;
}

/**
 * One Wikipedia event page's worth of the schedule pipeline: upsert the
 * event, then every `{{MMAevent bout}}` on it. Extracted from
 * syncSchedule.ts (I4) once backfillWikipediaHistory.ts became a second
 * caller needing the identical sequence -- syncSchedule.ts's twice-daily
 * upcoming-card sync is unchanged in behaviour, just no longer the only
 * place this logic lives.
 *
 * The bout write is deliberately the same shape whether the card is
 * upcoming or long finished: fetchEventSchedule only ever reports
 * fighter1 as the winner (the wiki template lists "Winner | def. |
 * Loser"), so `winner_id` is fighter1's id once the separator reads
 * "def." and null while the bout is still "vs.". `source: "wikipedia"`
 * routes winner/method/round into the per-source columns, never the
 * authoritative ones -- lib/settlement/ owns those (ARCHITECTURE.md
 * Fork 6).
 */
export async function processScheduleEvent(
  supabase: SupabaseClient,
  title: string,
  event: ScheduledEvent,
): Promise<ProcessScheduleEventResult> {
  if (!event.date) throw new Error(`processScheduleEvent called for "${title}" with no date`);

  const eventId = await upsertEvent(supabase, {
    external_id: title,
    name: title,
    event_date: event.date,
  });

  let fightCount = 0;
  for (const [index, bout] of event.bouts.entries()) {
    const fighter1Id = await upsertFighter(supabase, { name: bout.fighter1Name });
    const fighter2Id = await upsertFighter(supabase, { name: bout.fighter2Name });
    const winnerId = bout.winnerName ? fighter1Id : null;

    await upsertFight(supabase, {
      external_id: buildWikiFightExternalId(title, fighter1Id, fighter2Id),
      event_id: eventId,
      fighter1_id: fighter1Id,
      fighter2_id: fighter2Id,
      source: "wikipedia",
      winner_id: winnerId,
      method: bout.method,
      round: bout.round,
      weight_class: bout.weightClass,
      bout_order: index,
    });
    fightCount++;
  }

  return { eventId, fightCount };
}
