import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_RATING } from "../elo/eloMath";
import { fetchNearestUpcomingEventId } from "../events/nearestUpcomingEvent";
import { fetchLatestEloRatings } from "../elo/fetchLatestEloRatings";
import { computeScoutingInputHash } from "./computeScoutingInputHash";
import { RECENT_BOUT_WINDOW } from "./types";
import type { FighterNeedingDossier, ScoutingFighterBundle, ScoutingOpenFlag, ScoutingRecentBout } from "./types";

interface EmbeddedFighter {
  id: string;
  name: string;
  reach_cm: number | null;
  height_cm: number | null;
  birth_date: string | null;
  sherdog_wins_by_ko: number | null;
  sherdog_wins_by_sub: number | null;
  sherdog_wins_by_dec: number | null;
  sherdog_losses_by_ko: number | null;
  sherdog_losses_by_sub: number | null;
  sherdog_losses_by_dec: number | null;
}

interface EmbeddedFight {
  id: string;
  fighter1: EmbeddedFighter;
  fighter2: EmbeddedFighter;
}

/**
 * N7's map step, scoped the same way `generateInternPicks.ts` and the
 * rumour scan already are: the single nearest upcoming card, not the
 * whole future schedule (`fetchNearestUpcomingEventId.ts`'s own
 * reasoning applies unchanged here).
 *
 * Content-addressed: builds each roster fighter's `ScoutingFighterBundle`,
 * hashes it (`computeScoutingInputHash.ts`), and skips any fighter whose
 * exact `(fighter_id, input_hash)` already has a dossier row -- the
 * budget math this whole sub-phase exists for (~28 calls on a card's
 * first run, ~0 on the other 11 runs that day, since Elo only moves on
 * settlement and a fighter's Sherdog/physical data barely changes).
 *
 * No evidence, no dossier this run: a fighter this job cannot build a
 * full bundle for (should not happen -- `fights` always embeds both
 * fighters) is simply skipped, same "never guess without evidence"
 * posture `fetchOpenSherdogConflictsToPropose.ts` already takes.
 */
export async function fetchFightersNeedingDossiers(supabase: SupabaseClient): Promise<FighterNeedingDossier[]> {
  const eventId = await fetchNearestUpcomingEventId(supabase);
  if (eventId === null) return [];

  const { data: rawFights, error: fightsError } = await supabase
    .from("fights")
    .select(
      "id, " +
        "fighter1:fighter1_id(id, name, reach_cm, height_cm, birth_date, sherdog_wins_by_ko, sherdog_wins_by_sub, sherdog_wins_by_dec, sherdog_losses_by_ko, sherdog_losses_by_sub, sherdog_losses_by_dec), " +
        "fighter2:fighter2_id(id, name, reach_cm, height_cm, birth_date, sherdog_wins_by_ko, sherdog_wins_by_sub, sherdog_wins_by_dec, sherdog_losses_by_ko, sherdog_losses_by_sub, sherdog_losses_by_dec)",
    )
    .eq("event_id", eventId)
    .is("settled_at", null);
  if (fightsError) throw fightsError;

  const fights = (rawFights ?? []) as unknown as EmbeddedFight[];
  if (fights.length === 0) return [];

  const fightIds = fights.map((f) => f.id);
  const fighterById = new Map<string, EmbeddedFighter>();
  for (const fight of fights) {
    fighterById.set(fight.fighter1.id, fight.fighter1);
    fighterById.set(fight.fighter2.id, fight.fighter2);
  }
  const fighterIds = [...fighterById.keys()];

  const [eloByFighterId, boutsByFighterId, flagsByFighterId] = await Promise.all([
    fetchLatestEloRatings(supabase, fighterIds),
    fetchRecentBouts(supabase, fighterIds),
    fetchOpenFlagsByFighter(supabase, fightIds),
  ]);

  const bundles: ScoutingFighterBundle[] = fighterIds.map((fighterId) => {
    const f = fighterById.get(fighterId)!;
    const elo = eloByFighterId.get(fighterId) ?? { rating: DEFAULT_RATING, ratedFightCount: 0 };
    return {
      fighterId,
      name: f.name,
      eloRating: elo.rating,
      ratedFightCount: elo.ratedFightCount,
      reachCm: f.reach_cm,
      heightCm: f.height_cm,
      birthDate: f.birth_date,
      sherdogWinsByKo: f.sherdog_wins_by_ko,
      sherdogWinsBySub: f.sherdog_wins_by_sub,
      sherdogWinsByDec: f.sherdog_wins_by_dec,
      sherdogLossesByKo: f.sherdog_losses_by_ko,
      sherdogLossesBySub: f.sherdog_losses_by_sub,
      sherdogLossesByDec: f.sherdog_losses_by_dec,
      recentBouts: boutsByFighterId.get(fighterId) ?? [],
      openFlags: flagsByFighterId.get(fighterId) ?? [],
    };
  });

  const hashed = bundles.map((bundle) => ({ bundle, inputHash: computeScoutingInputHash(bundle) }));

  const existingHashesByFighterId = await fetchExistingDossierHashes(supabase, fighterIds);
  return hashed.filter(({ bundle, inputHash }) => {
    const existing = existingHashesByFighterId.get(bundle.fighterId);
    return existing === undefined || !existing.has(inputHash);
  });
}

async function fetchRecentBouts(
  supabase: SupabaseClient,
  fighterIds: string[],
): Promise<Map<string, ScoutingRecentBout[]>> {
  if (fighterIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("fighter_sherdog_bouts")
    .select("id, fighter_id, bout_order, result, opponent_name, event_name, event_date, method")
    .in("fighter_id", fighterIds)
    .order("bout_order", { ascending: true });
  if (error) throw error;

  const byFighterId = new Map<string, ScoutingRecentBout[]>();
  for (const row of data ?? []) {
    const fighterId = row.fighter_id as string;
    const list = byFighterId.get(fighterId) ?? [];
    if (list.length >= RECENT_BOUT_WINDOW) continue; // already have the most recent window
    list.push({
      id: row.id as string,
      result: row.result as ScoutingRecentBout["result"],
      opponentName: row.opponent_name as string,
      eventName: row.event_name as string | null,
      eventDate: row.event_date as string | null,
      method: row.method as string | null,
    });
    byFighterId.set(fighterId, list);
  }
  return byFighterId;
}

async function fetchOpenFlagsByFighter(
  supabase: SupabaseClient,
  fightIds: string[],
): Promise<Map<string, ScoutingOpenFlag[]>> {
  if (fightIds.length === 0) return new Map();

  // N3: a retracted flag must never feed a scouting read, same rule
  // fetchFlagsForFights.ts already applies to flagPenalty().
  const { data, error } = await supabase
    .from("rumour_flags")
    .select("id, fighter_id, category, summary")
    .in("fight_id", fightIds)
    .is("retracted_at", null);
  if (error) throw error;

  const byFighterId = new Map<string, ScoutingOpenFlag[]>();
  for (const row of data ?? []) {
    const fighterId = row.fighter_id as string;
    const list = byFighterId.get(fighterId) ?? [];
    list.push({ id: row.id as string, category: row.category as string, summary: row.summary as string });
    byFighterId.set(fighterId, list);
  }
  return byFighterId;
}

async function fetchExistingDossierHashes(
  supabase: SupabaseClient,
  fighterIds: string[],
): Promise<Map<string, Set<string>>> {
  if (fighterIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("fighter_scouting_dossiers")
    .select("fighter_id, input_hash")
    .in("fighter_id", fighterIds);
  if (error) throw error;

  const byFighterId = new Map<string, Set<string>>();
  for (const row of data ?? []) {
    const fighterId = row.fighter_id as string;
    const set = byFighterId.get(fighterId) ?? new Set<string>();
    set.add(row.input_hash as string);
    byFighterId.set(fighterId, set);
  }
  return byFighterId;
}
