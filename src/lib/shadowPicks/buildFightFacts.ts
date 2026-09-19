import type { SupabaseClient } from "@supabase/supabase-js";
import { ageOnDate } from "../../shared/utils/ageOnDate";
import { DEFAULT_RATING } from "../elo/eloMath";
import { fetchLatestEloRatings } from "../elo/fetchLatestEloRatings";
import { RECENT_BOUT_WINDOW } from "../scouting/types";
import type { ScoutingOpenFlag, ScoutingRecentBout } from "../scouting/types";
import type { ShadowPickDossierFacts, ShadowPickFightFacts, ShadowPickFighterFacts } from "./types";

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

export interface BuildFightFactsResult {
  fightsById: Map<string, ShadowPickFightFacts>;
  cardDate: string;
  // Per-fighter dossier freshness -- `fetchShadowPickCard.ts`'s own
  // needsRun gate reads this to tell whether a fight's dossiers changed
  // since its last shadow-pick run; the replay CLI has no use for it and
  // simply ignores it.
  dossierCreatedAtMsByFighterId: Map<string, number>;
}

function sumWins(f: EmbeddedFighter): number {
  return (f.sherdog_wins_by_ko ?? 0) + (f.sherdog_wins_by_sub ?? 0) + (f.sherdog_wins_by_dec ?? 0);
}
function sumLosses(f: EmbeddedFighter): number {
  return (f.sherdog_losses_by_ko ?? 0) + (f.sherdog_losses_by_sub ?? 0) + (f.sherdog_losses_by_dec ?? 0);
}

function buildFighterFacts(
  f: EmbeddedFighter,
  cardDate: string,
  eloByFighterId: Map<string, { rating: number; ratedFightCount: number }>,
  boutsByFighterId: Map<string, ScoutingRecentBout[]>,
  flagsByFighterId: Map<string, ScoutingOpenFlag[]>,
  dossier: ShadowPickDossierFacts,
): ShadowPickFighterFacts {
  const elo = eloByFighterId.get(f.id) ?? { rating: DEFAULT_RATING, ratedFightCount: 0 };
  return {
    fighterId: f.id,
    name: f.name,
    eloRating: elo.rating,
    ratedFightCount: elo.ratedFightCount,
    reachCm: f.reach_cm,
    heightCm: f.height_cm,
    ageYears: f.birth_date === null ? null : ageOnDate(f.birth_date, cardDate),
    sherdogWins: sumWins(f),
    sherdogLosses: sumLosses(f),
    dossier,
    recentBouts: boutsByFighterId.get(f.id) ?? [],
    openFlags: flagsByFighterId.get(f.id) ?? [],
  };
}

/**
 * N8's fact-gathering step, generalized for N9's replay CLI: takes
 * explicit `fightIds` instead of `fetchShadowPickCard.ts`'s own
 * nearest-upcoming-card/unsettled-only scope, so a settled fight from
 * weeks ago can be re-fed through the identical fact-building logic a
 * live run used, rather than a hand-copied reimplementation drifting
 * from the original the way `RETROSPECTIVE.md`'s entry #9 (name-variant
 * matching, two implementations, only one kept current) warns against.
 *
 * `cardDate` must be the ORIGINAL card's `events.event_date` -- ages are
 * measured on the card's own date (`ageOnDate`), never "today", so a
 * fighter's age in a replayed prompt matches what the live run actually
 * saw, not their age now.
 */
export async function buildFightFacts(
  supabase: SupabaseClient,
  fightIds: string[],
  cardDate: string,
): Promise<BuildFightFactsResult> {
  if (fightIds.length === 0) {
    return { fightsById: new Map(), cardDate, dossierCreatedAtMsByFighterId: new Map() };
  }

  const { data: rawFights, error: fightsError } = await supabase
    .from("fights")
    .select(
      "id, " +
        "fighter1:fighter1_id(id, name, reach_cm, height_cm, birth_date, sherdog_wins_by_ko, sherdog_wins_by_sub, sherdog_wins_by_dec, sherdog_losses_by_ko, sherdog_losses_by_sub, sherdog_losses_by_dec), " +
        "fighter2:fighter2_id(id, name, reach_cm, height_cm, birth_date, sherdog_wins_by_ko, sherdog_wins_by_sub, sherdog_wins_by_dec, sherdog_losses_by_ko, sherdog_losses_by_sub, sherdog_losses_by_dec)",
    )
    .in("id", fightIds);
  if (fightsError) throw fightsError;

  const fights = (rawFights ?? []) as unknown as EmbeddedFight[];
  if (fights.length === 0) {
    return { fightsById: new Map(), cardDate, dossierCreatedAtMsByFighterId: new Map() };
  }

  const fighterById = new Map<string, EmbeddedFighter>();
  for (const fight of fights) {
    fighterById.set(fight.fighter1.id, fight.fighter1);
    fighterById.set(fight.fighter2.id, fight.fighter2);
  }
  const fighterIds = [...fighterById.keys()];

  const [eloByFighterId, oddsByFightId, boutsByFighterId, flagsByFighterId, dossierByFighterId] = await Promise.all([
    fetchLatestEloRatings(supabase, fighterIds),
    fetchOdds(supabase, fightIds),
    fetchRecentBouts(supabase, fighterIds),
    fetchOpenFlagsByFighter(supabase, fightIds),
    fetchLatestDossiers(supabase, fighterIds),
  ]);

  const fightsById = new Map<string, ShadowPickFightFacts>();
  for (const fight of fights) {
    const dossier1 = dossierByFighterId.get(fight.fighter1.id);
    const dossier2 = dossierByFighterId.get(fight.fighter2.id);
    if (!dossier1 || !dossier2) continue; // same "no evidence, no write" rule fetchShadowPickCard.ts applies

    const f1 = buildFighterFacts(fight.fighter1, cardDate, eloByFighterId, boutsByFighterId, flagsByFighterId, dossier1);
    const f2 = buildFighterFacts(fight.fighter2, cardDate, eloByFighterId, boutsByFighterId, flagsByFighterId, dossier2);
    const odds = oddsByFightId.get(fight.id) ?? null;

    fightsById.set(fight.id, {
      fightId: fight.id,
      fighter1: f1,
      fighter2: f2,
      fighter1Price: odds?.fighter1Price ?? null,
      fighter2Price: odds?.fighter2Price ?? null,
    });
  }

  const dossierCreatedAtMsByFighterId = new Map<string, number>();
  for (const [fighterId, dossier] of dossierByFighterId) {
    dossierCreatedAtMsByFighterId.set(fighterId, dossier.createdAtMs);
  }

  return { fightsById, cardDate, dossierCreatedAtMsByFighterId };
}

async function fetchOdds(
  supabase: SupabaseClient,
  fightIds: string[],
): Promise<Map<string, { fighter1Price: number; fighter2Price: number; takenAtMs: number }>> {
  const { data, error } = await supabase
    .from("odds_snapshots")
    .select("fight_id, fighter1_price, fighter2_price, taken_at")
    .in("fight_id", fightIds);
  if (error) throw error;

  return new Map(
    (data ?? []).map((row) => [
      row.fight_id as string,
      {
        fighter1Price: Number(row.fighter1_price),
        fighter2Price: Number(row.fighter2_price),
        takenAtMs: new Date(row.taken_at as string).getTime(),
      },
    ]),
  );
}

async function fetchRecentBouts(
  supabase: SupabaseClient,
  fighterIds: string[],
): Promise<Map<string, ScoutingRecentBout[]>> {
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
    if (list.length >= RECENT_BOUT_WINDOW) continue;
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

async function fetchLatestDossiers(
  supabase: SupabaseClient,
  fighterIds: string[],
): Promise<Map<string, ShadowPickDossierFacts & { createdAtMs: number }>> {
  const { data, error } = await supabase
    .from("fighter_scouting_dossiers")
    .select("fighter_id, form_trajectory, stylistic_profile, durability, layoff, created_at")
    .in("fighter_id", fighterIds)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const byFighterId = new Map<string, ShadowPickDossierFacts & { createdAtMs: number }>();
  for (const row of data ?? []) {
    const fighterId = row.fighter_id as string;
    if (byFighterId.has(fighterId)) continue; // already have the latest (rows ordered desc)
    byFighterId.set(fighterId, {
      formTrajectory: row.form_trajectory as string,
      stylisticProfile: row.stylistic_profile as string,
      durability: row.durability as string,
      layoff: row.layoff as string,
      createdAtMs: new Date(row.created_at as string).getTime(),
    });
  }
  return byFighterId;
}
