import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchNearestUpcomingEventId } from "../events/nearestUpcomingEvent";
import { isPickLocked } from "../picks/pickLockOffsets";
import { buildFightFacts } from "./buildFightFacts";
import { needsShadowPickRerun } from "./needsShadowPickRerun";
import type { ShadowPickFightFacts } from "./types";

export interface ShadowPickCard {
  eventId: string;
  fights: ShadowPickFightFacts[];
  // True when at least one eligible fight's newest dossier is newer than
  // that fight's last shadow pick (or it has never had one) -- the ">=1
  // dossier changed" gate the plan requires before this run spends the
  // one reduce call it would otherwise cost every time it's invoked.
  needsRun: boolean;
}

/**
 * N8's fact-gathering step. One card = the same nearest-upcoming-event
 * scope every other Phase N surface uses (`fetchNearestUpcomingEventId`).
 * Fact-building itself lives in `buildFightFacts.ts` (extracted for N9's
 * replay CLI, which needs the identical logic over explicit past
 * fightIds instead of this function's own nearest-upcoming/unsettled-only
 * scope) -- this function is now just that scope plus the needsRun gate
 * and card lock check layered on top.
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
    .select("id")
    .eq("event_id", eventId)
    .is("settled_at", null);
  if (fightsError) throw fightsError;

  const fightIds = (rawFights ?? []).map((f) => f.id as string);
  if (fightIds.length === 0) return null;

  const { fightsById, dossierCreatedAtMsByFighterId } = await buildFightFacts(supabase, fightIds, cardDate);
  if (fightsById.size === 0) return null;

  const [oddsByFightId, lastRunByFightId] = await Promise.all([
    fetchOdds(supabase, fightIds),
    fetchLastShadowPickCreatedAt(supabase, fightIds),
  ]);

  const fightFacts: ShadowPickFightFacts[] = [];
  let needsRun = false;

  for (const facts of fightsById.values()) {
    const odds = oddsByFightId.get(facts.fightId) ?? null;
    const lastRunAtMs = lastRunByFightId.get(facts.fightId);
    const newestDossierAt = Math.max(
      dossierCreatedAtMsByFighterId.get(facts.fighter1.fighterId) ?? 0,
      dossierCreatedAtMsByFighterId.get(facts.fighter2.fighterId) ?? 0,
    );
    if (
      needsShadowPickRerun({
        newestDossierAtMs: newestDossierAt,
        lastRunAtMs,
        oddsTakenAtMs: odds?.takenAtMs ?? null,
      })
    ) {
      needsRun = true;
    }
    fightFacts.push(facts);
  }

  if (fightFacts.length === 0) return null;
  return { eventId, fights: fightFacts, needsRun };
}

async function fetchOdds(
  supabase: SupabaseClient,
  fightIds: string[],
): Promise<Map<string, { fighter1Price: number; fighter2Price: number; takenAtMs: number }>> {
  if (fightIds.length === 0) return new Map();

  // taken_at feeds needsShadowPickRerun.ts -- a price that lands after
  // this fight's last shadow-pick run must trigger a fresh one, the same
  // way a newer dossier already does.
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
