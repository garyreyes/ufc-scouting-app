import type { SupabaseClient } from "@supabase/supabase-js";
import { ageOnDate } from "../../shared/utils/ageOnDate";
import { DEFAULT_RATING } from "../elo/eloMath";
import { fetchLatestEloRatings } from "../elo/fetchLatestEloRatings";
import { fetchNearestUpcomingEventId } from "../events/nearestUpcomingEvent";
import { isPickLocked } from "../picks/pickLockOffsets";
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

export interface ShadowPickCard {
  eventId: string;
  fights: ShadowPickFightFacts[];
  // True when at least one eligible fight's newest dossier is newer than
  // that fight's last shadow pick (or it has never had one) -- the ">=1
  // dossier changed" gate the plan requires before this run spends the
  // one reduce call it would otherwise cost every time it's invoked.
  needsRun: boolean;
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
 * N8's fact-gathering step. One card = the same nearest-upcoming-event
 * scope every other Phase N surface uses (`fetchNearestUpcomingEventId`).
 * A fight is only eligible once BOTH fighters have at least one N7
 * dossier -- no dossier, no evidence this call could ground a claim in,
 * the same "no evidence, no write" posture N7 itself takes on a fighter
 * it cannot build a bundle for.
 *
 * Card-wide lock, not per-fight: every fight on one card shares the same
 * `events.starts_at`, so Fork 10's own lock offset (`pickLockOffsets.ts`,
 * 6h for INTERN) already gates the whole card at once -- the identical
 * definition real picks use, not a re-derived one (DECISIONS.md,
 * 2026-09-18, "N8: shadow picks revise until card lock").
 */
export async function fetchShadowPickCard(supabase: SupabaseClient): Promise<ShadowPickCard | null> {
  const eventId = await fetchNearestUpcomingEventId(supabase);
  if (eventId === null) return null;

  const { data: eventRow, error: eventError } = await supabase
    .from("events")
    .select("event_date, starts_at")
    .eq("id", eventId)
    .single();
  if (eventError) throw eventError;
  const cardDate = eventRow.event_date as string;
  const startsAt = eventRow.starts_at as string | null;

  if (isPickLocked(startsAt, "INTERN", new Date())) return null;

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
  if (fights.length === 0) return null;

  const fightIds = fights.map((f) => f.id);
  const fighterById = new Map<string, EmbeddedFighter>();
  for (const fight of fights) {
    fighterById.set(fight.fighter1.id, fight.fighter1);
    fighterById.set(fight.fighter2.id, fight.fighter2);
  }
  const fighterIds = [...fighterById.keys()];

  const [eloByFighterId, oddsByFightId, boutsByFighterId, flagsByFighterId, dossierByFighterId, lastRunByFightId] =
    await Promise.all([
      fetchLatestEloRatings(supabase, fighterIds),
      fetchOdds(supabase, fightIds),
      fetchRecentBouts(supabase, fighterIds),
      fetchOpenFlagsByFighter(supabase, fightIds),
      fetchLatestDossiers(supabase, fighterIds),
      fetchLastShadowPickCreatedAt(supabase, fightIds),
    ]);

  const fightFacts: ShadowPickFightFacts[] = [];
  let needsRun = false;

  for (const fight of fights) {
    const dossier1 = dossierByFighterId.get(fight.fighter1.id);
    const dossier2 = dossierByFighterId.get(fight.fighter2.id);
    // No evidence, no shadow pick for this fight this run -- mirrors N7's
    // own posture, rather than asking the model to reason about a fighter
    // it has no scouting read for at all.
    if (!dossier1 || !dossier2) continue;

    const f1 = buildFighterFacts(fight.fighter1, cardDate, eloByFighterId, boutsByFighterId, flagsByFighterId, dossier1);
    const f2 = buildFighterFacts(fight.fighter2, cardDate, eloByFighterId, boutsByFighterId, flagsByFighterId, dossier2);
    const odds = oddsByFightId.get(fight.id) ?? null;

    const newestDossierAt = Math.max(dossier1.createdAtMs, dossier2.createdAtMs);
    const lastRunAtMs = lastRunByFightId.get(fight.id);
    if (lastRunAtMs === undefined || newestDossierAt > lastRunAtMs) needsRun = true;

    fightFacts.push({
      fightId: fight.id,
      fighter1: f1,
      fighter2: f2,
      fighter1Price: odds?.fighter1Price ?? null,
      fighter2Price: odds?.fighter2Price ?? null,
    });
  }

  if (fightFacts.length === 0) return null;
  return { eventId, fights: fightFacts, needsRun };
}

async function fetchOdds(
  supabase: SupabaseClient,
  fightIds: string[],
): Promise<Map<string, { fighter1Price: number; fighter2Price: number }>> {
  if (fightIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("odds_snapshots")
    .select("fight_id, fighter1_price, fighter2_price")
    .in("fight_id", fightIds);
  if (error) throw error;

  return new Map(
    (data ?? []).map((row) => [
      row.fight_id as string,
      { fighter1Price: Number(row.fighter1_price), fighter2Price: Number(row.fighter2_price) },
    ]),
  );
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
  if (fightIds.length === 0) return new Map();

  // N3: a retracted flag must never feed a scouting read, same rule
  // fetchFlagsForFights.ts / fetchFightersNeedingDossiers.ts already apply.
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
  if (fighterIds.length === 0) return new Map();

  // Latest row per fighter regardless of hash -- an unchanged hash still
  // means the dossier's own last write is the freshest valid read; this
  // is a plain freshness query, not the cache-hit check N7's own
  // fetchFightersNeedingDossiers.ts does for a different purpose.
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

async function fetchLastShadowPickCreatedAt(
  supabase: SupabaseClient,
  fightIds: string[],
): Promise<Map<string, number>> {
  if (fightIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("shadow_picks")
    .select("fight_id, created_at")
    .eq("line", "LLM_ASSISTED")
    .in("fight_id", fightIds)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const byFightId = new Map<string, number>();
  for (const row of data ?? []) {
    const fightId = row.fight_id as string;
    if (byFightId.has(fightId)) continue; // already have the latest (rows ordered desc)
    byFightId.set(fightId, new Date(row.created_at as string).getTime());
  }
  return byFightId;
}
