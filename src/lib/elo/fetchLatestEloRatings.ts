import type { SupabaseClient } from "@supabase/supabase-js";

export interface EloInfo {
  rating: number;
  ratedFightCount: number;
}

/**
 * Each fighter's most recent Elo snapshot and how many rated fights it's
 * built on -- fetches the WHOLE history for just the fighters asked for
 * (always a small set: one card, or one bout) and reduces client-side,
 * the same "fetch broadly, merge in JS" pattern used throughout this
 * codebase, rather than one per-fighter query.
 *
 * **Extracted from lib/intern/generateInternPicks.ts in I5**, when the
 * fight page's tale-of-the-tape became its second caller. Reading a
 * rating is not intern-specific -- the intern's reasoning line already
 * quotes these two numbers, and the tape showing the same two is what
 * makes that line legible rather than unexplained.
 *
 * Safe to call with either client: fighter_elo_history is public-read
 * with an anon grant (0029), so a page-level read through the public
 * client returns the same rows the admin client sees.
 *
 * A fighter with no rated history is simply ABSENT from the map -- no
 * seed row is ever written for a debutant. Callers apply eloMath.ts's
 * DEFAULT_RATING at read time, or say "unrated," as suits them.
 */
export async function fetchLatestEloRatings(
  supabase: SupabaseClient,
  fighterIds: string[],
): Promise<Map<string, EloInfo>> {
  if (fighterIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("fighter_elo_history")
    .select("fighter_id, rating, fight_occurred_at")
    .in("fighter_id", fighterIds)
    .order("fight_occurred_at", { ascending: true });
  if (error) throw error;

  const result = new Map<string, EloInfo>();
  for (const row of data ?? []) {
    const fighterId = row.fighter_id as string;
    const existing = result.get(fighterId);
    // Ascending order means the last row seen per fighter is their most
    // recent -- overwrite rating each time, but always increment the
    // count so it ends up as the true total rated-fight count.
    result.set(fighterId, {
      rating: Number(row.rating),
      ratedFightCount: (existing?.ratedFightCount ?? 0) + 1,
    });
  }
  return result;
}
