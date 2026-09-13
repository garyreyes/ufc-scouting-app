import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/db";
import { isInvalidIdError } from "@/lib/isInvalidIdError";
import { selectAllPages } from "@/lib/supabase/selectAllPages";
import { chunk, DEFAULT_CHUNK_SIZE } from "@/lib/supabase/chunk";
import type { Fighter, FighterFightHistoryEntry, SherdogBout } from "./types";

const FIGHTER_COLUMNS =
  "id, name, height_cm, reach_cm, weight_class, stance, wins, losses, draws, sherdog_wins_by_ko, sherdog_wins_by_sub, sherdog_wins_by_dec, sherdog_losses_by_ko, sherdog_losses_by_sub, sherdog_losses_by_dec, sherdog_history_imported_at";

/**
 * M1: paged with selectAllPages -- a plain `.select()` silently truncates
 * at PostgREST's row cap, and `fighters` (822 rows live, 2026-09-13) is
 * one growth cycle from crossing it. `supabaseClient` defaults to the
 * shared singleton so both call sites (app/fighters/page.tsx) are
 * unchanged; tests inject a fake instead.
 */
export async function getFighters(
  query: string,
  weightClasses: string[] = [],
  supabaseClient: SupabaseClient = supabase,
): Promise<Fighter[]> {
  const trimmed = query.trim();
  const data = await selectAllPages<Fighter>(
    supabaseClient,
    "fighters",
    FIGHTER_COLUMNS,
    trimmed ? (q) => q.ilike("name", `%${trimmed}%`) : undefined,
  );

  const resolved = await fillMissingWeightClasses(data, supabaseClient);

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
//
// M1: `missingIds` is chunked before building the `.or()` clause -- an
// unchunked list is an unbounded request URL, the same failure class as
// an unpaged `.select()` (a hard error instead of a silent one, but still
// unbounded on the number of missing-weight-class fighters).
async function fillMissingWeightClasses(
  fighters: Fighter[],
  supabaseClient: SupabaseClient,
): Promise<Fighter[]> {
  const missingIds = fighters.filter((f) => !f.weight_class).map((f) => f.id);
  if (missingIds.length === 0) return fighters;
  const missingIdSet = new Set(missingIds);

  const latestByFighterId = new Map<string, { weight_class: string | null; date: string }>();

  for (const idChunk of chunk(missingIds, DEFAULT_CHUNK_SIZE)) {
    const idList = idChunk.join(",");
    const { data: fights, error } = await supabaseClient
      .from("fights")
      .select("weight_class, fighter1_id, fighter2_id, event:event_id(event_date)")
      .or(`fighter1_id.in.(${idList}),fighter2_id.in.(${idList})`);
    if (error) throw error;

    for (const fight of fights as unknown as {
      weight_class: string | null;
      fighter1_id: string;
      fighter2_id: string;
      event: { event_date: string };
    }[]) {
      for (const fighterId of [fight.fighter1_id, fight.fighter2_id]) {
        if (!missingIdSet.has(fighterId) || !fight.weight_class) continue;
        const current = latestByFighterId.get(fighterId);
        if (!current || fight.event.event_date > current.date) {
          latestByFighterId.set(fighterId, { weight_class: fight.weight_class, date: fight.event.event_date });
        }
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
  sherdogBouts: SherdogBout[];
} | null> {
  const { data: fighter, error: fighterError } = await supabase
    .from("fighters")
    .select("id, name, height_cm, reach_cm, weight_class, stance, wins, losses, draws, sherdog_wins_by_ko, sherdog_wins_by_sub, sherdog_wins_by_dec, sherdog_losses_by_ko, sherdog_losses_by_sub, sherdog_losses_by_dec, sherdog_history_imported_at")
    .eq("id", id)
    .maybeSingle();
  if (fighterError) {
    if (isInvalidIdError(fighterError)) return null;
    throw fighterError;
  }
  if (!fighter) return null;

  const { data: fights, error: fightsError } = await supabase
    .from("fights")
    .select(
      "id, weight_class, method, round, winner_id, event:event_id(id, name, event_date), fighter1:fighter1_id(id, name), fighter2:fighter2_id(id, name)",
    )
    .or(`fighter1_id.eq.${id},fighter2_id.eq.${id}`);
  if (fightsError) throw fightsError;

  // The Sherdog sidecar (J4): a fighter's full career, separate from the
  // app's own fight graph above. Capped-return safe -- a career is at
  // most ~70 bouts, far under PostgREST's row cap.
  const { data: sherdogBouts, error: boutsError } = await supabase
    .from("fighter_sherdog_bouts")
    .select(
      "bout_order, result, opponent_name, opponent_sherdog_id, event_name, event_date, method, round, bout_time",
    )
    .eq("fighter_id", id)
    .order("bout_order", { ascending: true });
  if (boutsError) throw boutsError;

  return {
    fighter,
    fights: fights as unknown as FighterFightHistoryEntry[],
    sherdogBouts: (sherdogBouts ?? []) as SherdogBout[],
  };
}
