import type { SupabaseClient } from "@supabase/supabase-js";
import type { MyQuickPick } from "./types";

/**
 * The owner's own USER picks among a given set of fights -- what the
 * collapsed row needs to show "your pick: Fighter X" instead of the
 * tap-to-pick prompt. Takes a session-aware client (lib/supabase/
 * server.ts) rather than the plain public one: picks has no anon grant
 * at all, and RLS itself is the real gate here (0019_picks.sql's "picks:
 * owner reads all" policy) -- unlike data_conflicts/job_runs, this table
 * has real client-facing policies, so there's no need to route through
 * the admin client the way features/conflicts/api.ts or features/
 * job-health/api.ts do.
 *
 * Takes fightIds rather than an eventId to avoid filtering through an
 * embedded relation -- the caller (the card-view page) already has the
 * card's fight ids from getCardView, so this stays a plain, unambiguous
 * `.in()` query.
 *
 * Returns an empty map for a logged-out or non-owner viewer -- RLS
 * simply returns zero rows for them rather than erroring, which is
 * exactly the "read-only card" behaviour the auth gate wants.
 */
export async function getMyPicksForFights(
  supabase: SupabaseClient,
  fightIds: string[],
): Promise<Map<string, MyQuickPick>> {
  if (fightIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("picks")
    .select("fight_id, predicted_fighter_id")
    .eq("author", "USER")
    .in("fight_id", fightIds);
  if (error) throw error;

  return new Map(
    (data ?? []).map((row) => [
      row.fight_id as string,
      { fightId: row.fight_id as string, predictedFighterId: row.predicted_fighter_id as string },
    ]),
  );
}
