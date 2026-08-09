import { supabase } from "@/lib/db";
import type { Fighter, FighterFightHistoryEntry } from "./types";

export async function getFighters(
  query: string,
  weightClasses: string[] = [],
): Promise<Fighter[]> {
  let request = supabase
    .from("fighters")
    .select("id, name, height_cm, reach_cm, weight_class, stance, wins, losses, draws")
    .order("name", { ascending: true });

  if (query.trim()) {
    request = request.ilike("name", `%${query.trim()}%`);
  }

  const { data, error } = await request;
  if (error) throw error;

  const resolved = await fillMissingWeightClasses(data);

  // Filtered against the *resolved* weight class, not the raw column --
  // most fighters (128 of ~144 at last count) only have one via the
  // fights fallback below, since they're Wikipedia-only placeholders with
  // no API-Sports profile yet. Filtering on the raw column alone made the
  // filter useless for almost the whole roster.
  if (weightClasses.length === 0) return resolved;
  return resolved.filter((fighter) => fighter.weight_class && weightClasses.includes(fighter.weight_class));
}

// Placeholder fighters synced from Wikipedia (upcoming fights only, no
// API-Sports profile yet) have no weight_class of their own. One batched
// query for their most recent fight's weight class, instead of one query
// per fighter, so the grid doesn't show "unknown" for every fight still
// waiting on API-Sports to catch up.
async function fillMissingWeightClasses(fighters: Fighter[]): Promise<Fighter[]> {
  const missingIds = fighters.filter((f) => !f.weight_class).map((f) => f.id);
  if (missingIds.length === 0) return fighters;

  const idList = missingIds.join(",");
  const { data: fights, error } = await supabase
    .from("fights")
    .select("weight_class, fighter1_id, fighter2_id, event:event_id(event_date)")
    .or(`fighter1_id.in.(${idList}),fighter2_id.in.(${idList})`);
  if (error) throw error;

  const latestByFighterId = new Map<string, { weight_class: string | null; date: string }>();
  for (const fight of fights as unknown as {
    weight_class: string | null;
    fighter1_id: string;
    fighter2_id: string;
    event: { event_date: string };
  }[]) {
    for (const fighterId of [fight.fighter1_id, fight.fighter2_id]) {
      if (!missingIds.includes(fighterId) || !fight.weight_class) continue;
      const current = latestByFighterId.get(fighterId);
      if (!current || fight.event.event_date > current.date) {
        latestByFighterId.set(fighterId, { weight_class: fight.weight_class, date: fight.event.event_date });
      }
    }
  }

  return fighters.map((fighter) =>
    fighter.weight_class
      ? fighter
      : { ...fighter, weight_class: latestByFighterId.get(fighter.id)?.weight_class ?? null },
  );
}

export async function getFighterById(id: string): Promise<{
  fighter: Fighter;
  fights: FighterFightHistoryEntry[];
} | null> {
  const { data: fighter, error: fighterError } = await supabase
    .from("fighters")
    .select("id, name, height_cm, reach_cm, weight_class, stance, wins, losses, draws")
    .eq("id", id)
    .maybeSingle();
  if (fighterError) throw fighterError;
  if (!fighter) return null;

  const { data: fights, error: fightsError } = await supabase
    .from("fights")
    .select(
      "id, weight_class, method, round, winner_id, event:event_id(id, name, event_date), fighter1:fighter1_id(id, name), fighter2:fighter2_id(id, name)",
    )
    .or(`fighter1_id.eq.${id},fighter2_id.eq.${id}`);
  if (fightsError) throw fightsError;

  return { fighter, fights: fights as unknown as FighterFightHistoryEntry[] };
}
