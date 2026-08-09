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
  if (weightClasses.length > 0) {
    request = request.in("weight_class", weightClasses);
  }

  const { data, error } = await request;
  if (error) throw error;
  return data;
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
