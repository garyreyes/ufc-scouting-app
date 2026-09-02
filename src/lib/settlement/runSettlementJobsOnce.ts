import type { SupabaseClient } from "@supabase/supabase-js";
import { runWithTracking } from "../jobs/runWithTracking";
import { recomputeEloRatings, type RecomputeEloSummary } from "../elo/recomputeEloRatings";
import { settleFights, type SettleFightsSummary } from "./settleFights";
import { settlePicks, type SettlePicksSummary } from "./settlePicks";

export interface SettlementJobsSummary {
  fights: SettleFightsSummary;
  picks: SettlePicksSummary;
  elo: RecomputeEloSummary;
}

/**
 * D1, then D2, then an Elo recompute, in that order and in one script --
 * same shape as lib/odds/runOddsJobsOnce.ts's discovery-then-snapshot
 * chain. D2 needs D1's freshly-settled fights to have anything to do, so
 * running them apart would just mean picks wait an extra cycle for no
 * reason. The Elo recompute (G1-follow-up) belongs right here too: "a
 * new result was just discovered" is exactly the moment fighter ratings
 * need to move, and it needs the same full settled-fights picture D1 just
 * produced. Each step still gets its own job_runs row (own job name), so
 * a failure in one doesn't obscure whether the others ran.
 */
export async function runSettlementJobsOnce(supabase: SupabaseClient): Promise<SettlementJobsSummary> {
  const fights = await runWithTracking(supabase, "settle_fights", () => settleFights(supabase));
  const picks = await runWithTracking(supabase, "settle_picks", () => settlePicks(supabase));
  const elo = await runWithTracking(supabase, "recompute_elo", () => recomputeEloRatings(supabase));
  return { fights, picks, elo };
}
