import { createClient } from "@/lib/supabase/server";
import type { FighterScoutingReport, ScoutingReport } from "./types";

// RLS on scouting_reports already filters to "reports this session's
// user is allowed to see" (own reports, or shared via clan visibility).
export async function getReportsForFight(fightId: string): Promise<ScoutingReport[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scouting_reports")
    .select("id, fight_id, user_id, body, visibility, created_at, profiles:user_id(display_name)")
    .eq("fight_id", fightId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  return (
    data as unknown as (Omit<ScoutingReport, "author_name"> & {
      profiles: { display_name: string | null } | null;
    })[]
  ).map((row) => ({ ...row, author_name: row.profiles?.display_name ?? null }));
}

export async function getReportsForFighter(fighterId: string): Promise<FighterScoutingReport[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fighter_scouting_reports")
    .select("id, fighter_id, user_id, body, visibility, created_at, profiles:user_id(display_name)")
    .eq("fighter_id", fighterId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  return (
    data as unknown as (Omit<FighterScoutingReport, "author_name"> & {
      profiles: { display_name: string | null } | null;
    })[]
  ).map((row) => ({ ...row, author_name: row.profiles?.display_name ?? null }));
}
