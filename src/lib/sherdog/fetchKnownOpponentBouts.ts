import type { SupabaseClient } from "@supabase/supabase-js";
import type { KnownOpponentBout } from "./historyCorroborates";

/**
 * M5: every opponent + event date this fighter is already on record
 * against in OUR OWN data, regardless of settlement status -- the I/O
 * side of historyCorroborates.ts. Deliberately not filtered to past-only:
 * a not-yet-settled fight is still a real, dated matchup our own sync
 * already confirmed, and excluding it would just throw away a corroboration
 * signal for no safety reason (a wrong corroboration here only ever
 * requires a real opponent name AND a real date to already coincide,
 * which `namesLikelySamePerson` + the +/-10 day window already guard).
 */
export async function fetchKnownOpponentBouts(
  supabase: SupabaseClient,
  fighterId: string,
): Promise<KnownOpponentBout[]> {
  const { data: fights, error: fightsError } = await supabase
    .from("fights")
    .select("event_id, fighter1_id, fighter2_id")
    .or(`fighter1_id.eq.${fighterId},fighter2_id.eq.${fighterId}`);
  if (fightsError) throw fightsError;
  if (!fights || fights.length === 0) return [];

  const opponentIds = [
    ...new Set(
      fights.map((f) => (f.fighter1_id === fighterId ? f.fighter2_id : f.fighter1_id)),
    ),
  ];
  const eventIds = [...new Set(fights.map((f) => f.event_id))];

  const [{ data: opponents, error: opponentsError }, { data: events, error: eventsError }] =
    await Promise.all([
      supabase.from("fighters").select("id, name").in("id", opponentIds),
      supabase.from("events").select("id, event_date").in("id", eventIds),
    ]);
  if (opponentsError) throw opponentsError;
  if (eventsError) throw eventsError;

  const nameById = new Map((opponents ?? []).map((o) => [o.id as string, o.name as string]));
  const dateById = new Map((events ?? []).map((e) => [e.id as string, e.event_date as string | null]));

  const bouts: KnownOpponentBout[] = [];
  for (const f of fights) {
    const opponentId = f.fighter1_id === fighterId ? f.fighter2_id : f.fighter1_id;
    const opponentName = nameById.get(opponentId);
    const eventDate = dateById.get(f.event_id);
    if (opponentName && eventDate) bouts.push({ opponentName, eventDate });
  }
  return bouts;
}
