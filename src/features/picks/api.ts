import type { SupabaseClient } from "@supabase/supabase-js";
import type { InternPickSummary, MyPick, PickFields } from "./types";

/**
 * The owner's own USER picks among a given set of fights -- the full row
 * (C4 widened this from C3's predictedFighterId-only slice so BetRow can
 * prefill confidence/reasoning/bet fields on reopen instead of asking the
 * owner to re-enter what they already said). Takes a session-aware client
 * (lib/supabase/server.ts) rather than the plain public one: picks has no
 * anon grant at all, and RLS itself is the real gate here (0019_picks.sql's
 * "picks: owner reads all" policy) -- unlike data_conflicts/job_runs, this
 * table has real client-facing policies, so there's no need to route
 * through the admin client the way features/conflicts/api.ts or features/
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
): Promise<Map<string, MyPick>> {
  if (fightIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("picks")
    .select(
      "fight_id, predicted_fighter_id, estimated_probability, confidence, predicted_method, reasoning, bet_fighter_id, stake_units",
    )
    .eq("author", "USER")
    .in("fight_id", fightIds);
  if (error) throw error;

  return new Map(
    (data ?? []).map((row) => [
      row.fight_id as string,
      {
        fightId: row.fight_id as string,
        predictedFighterId: row.predicted_fighter_id as string,
        estimatedProbability: row.estimated_probability as number,
        confidence: row.confidence as number,
        predictedMethod: row.predicted_method as PickFields["predictedMethod"],
        reasoning: row.reasoning as string | null,
        betFighterId: row.bet_fighter_id as string | null,
        stakeUnits: row.stake_units as number | null,
      },
    ]),
  );
}

/**
 * The intern's own picks among a given set of fights -- closes a gap G1
 * itself named as still open: "nothing yet surfaces the intern's pick on
 * the card view row" (ROADMAP.md, docs/user-flows.md Flow 1 node J).
 *
 * Same session-aware client and same RLS reasoning as getMyPicksForFights
 * above -- `picks` has no anon grant (C1: "owner-only, not public, for
 * now just me until I prove the picks are actually reliable"), so this
 * is called from the same owner-gated branch on /events/[id], never from
 * the read-only path. A logged-out or non-owner viewer gets zero rows
 * back from RLS either way, same as getMyPicksForFights.
 */
export async function getInternPicksForFights(
  supabase: SupabaseClient,
  fightIds: string[],
): Promise<Map<string, InternPickSummary>> {
  if (fightIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("picks")
    .select(
      "fight_id, predicted_fighter_id, estimated_probability, confidence, reasoning, predicted_method, bet_fighter_id, stake_units",
    )
    .eq("author", "INTERN")
    .in("fight_id", fightIds);
  if (error) throw error;

  return new Map(
    (data ?? []).map((row) => [
      row.fight_id as string,
      {
        fightId: row.fight_id as string,
        predictedFighterId: row.predicted_fighter_id as string,
        estimatedProbability: row.estimated_probability as number,
        confidence: row.confidence as number,
        reasoning: row.reasoning as string | null,
        predictedMethod: row.predicted_method as PickFields["predictedMethod"],
        betFighterId: row.bet_fighter_id as string | null,
        stakeUnits: row.stake_units as number | null,
      },
    ]),
  );
}
