import type { SupabaseClient } from "@supabase/supabase-js";
import type { FightToScan } from "./scanFightForRumours";
import type { OpenFlagForRetraction } from "./types";

/**
 * Every currently-open (non-retracted) flag on the given fights, each
 * carrying its real most-recent-source date -- computed the same way
 * fetchFlagsForFights.ts computes corroboration count: read the real
 * rumour_sources rows and aggregate in TypeScript, never a stored or
 * joined aggregate that could drift from what actually backs the flag.
 *
 * A flag with zero real sources (should be structurally impossible --
 * parseClusterResponse.ts and heuristicCluster.ts both require at least
 * one before a flag is ever written -- but not worth trusting blindly) is
 * excluded rather than given a guessed date: retractionChecks.ts's
 * "strictly newer" check has nothing honest to compare against for it.
 */
export async function fetchOpenFlagsForRetraction(
  supabase: SupabaseClient,
  fights: FightToScan[],
): Promise<OpenFlagForRetraction[]> {
  const fightIds = fights.map((f) => f.id);
  if (fightIds.length === 0) return [];

  const fightById = new Map(fights.map((f) => [f.id, f]));

  const { data: flags, error: flagsError } = await supabase
    .from("rumour_flags")
    .select("id, fight_id, fighter_id, category, summary")
    .in("fight_id", fightIds)
    .is("retracted_at", null);
  if (flagsError) throw flagsError;
  if (!flags || flags.length === 0) return [];

  const flagIds = flags.map((f) => f.id as string);
  const { data: sources, error: sourcesError } = await supabase
    .from("rumour_sources")
    .select("flag_id, post_created_at")
    .in("flag_id", flagIds);
  if (sourcesError) throw sourcesError;

  const latestByFlagId = new Map<string, string>();
  for (const s of sources ?? []) {
    const flagId = s.flag_id as string;
    const createdAt = s.post_created_at as string;
    const current = latestByFlagId.get(flagId);
    if (!current || new Date(createdAt).getTime() > new Date(current).getTime()) {
      latestByFlagId.set(flagId, createdAt);
    }
  }

  const result: OpenFlagForRetraction[] = [];
  for (const flag of flags) {
    const fight = fightById.get(flag.fight_id as string);
    const mostRecentSourceAt = latestByFlagId.get(flag.id as string);
    if (!fight || !mostRecentSourceAt) continue; // no real source to compare against -- see header

    result.push({
      id: flag.id as string,
      fightId: flag.fight_id as string,
      fighterId: flag.fighter_id as string,
      fighter1: fight.fighter1,
      fighter2: fight.fighter2,
      category: flag.category as OpenFlagForRetraction["category"],
      summary: flag.summary as string,
      mostRecentSourceAt,
    });
  }
  return result;
}
