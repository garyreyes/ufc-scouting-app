import type { SupabaseClient } from "@supabase/supabase-js";
import type { RumourCategory } from "./types";

export interface FlagWithCount {
  fightId: string;
  fighterId: string;
  category: RumourCategory;
  corroborationCount: number;
}

/**
 * Rumour flags for a set of fights, each with its real corroboration
 * count -- count(*) on rumour_sources at read time, never a stored
 * number (0024_rumour_flags_and_sources.sql's own rule).
 *
 * Lives here rather than in features/rumours/api.ts because it takes the
 * client as a parameter: the Phase G intern job reads these with the
 * service-role admin client from inside a batch job, and lib/ must not
 * import from features/ (CLAUDE.md's layer boundaries). features/rumours/
 * api.ts keeps its own anon-client version for page reads; if that ever
 * wants to share this, it's a one-line change.
 */
export async function fetchFlagsForFights(
  supabase: SupabaseClient,
  fightIds: string[],
): Promise<FlagWithCount[]> {
  if (fightIds.length === 0) return [];

  const { data: flags, error: flagsError } = await supabase
    .from("rumour_flags")
    .select("id, fight_id, fighter_id, category")
    .in("fight_id", fightIds);
  if (flagsError) throw flagsError;
  if (!flags || flags.length === 0) return [];

  const { data: sources, error: sourcesError } = await supabase
    .from("rumour_sources")
    .select("flag_id")
    .in(
      "flag_id",
      flags.map((f) => f.id as string),
    );
  if (sourcesError) throw sourcesError;

  const countByFlagId = new Map<string, number>();
  for (const s of sources ?? []) {
    const flagId = s.flag_id as string;
    countByFlagId.set(flagId, (countByFlagId.get(flagId) ?? 0) + 1);
  }

  return flags.map((f) => ({
    fightId: f.fight_id as string,
    fighterId: f.fighter_id as string,
    category: f.category as RumourCategory,
    corroborationCount: countByFlagId.get(f.id as string) ?? 0,
  }));
}
