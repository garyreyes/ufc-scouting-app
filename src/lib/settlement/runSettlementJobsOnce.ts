import type { SupabaseClient } from "@supabase/supabase-js";
import { runWithTracking } from "../jobs/runWithTracking";
import { settleFights, type SettleFightsSummary } from "./settleFights";
import { settlePicks, type SettlePicksSummary } from "./settlePicks";

export interface SettlementJobsSummary {
  fights: SettleFightsSummary;
  picks: SettlePicksSummary;
}

/**
 * D1 then D2, in that order and in one script -- same shape as
 * lib/odds/runOddsJobsOnce.ts's discovery-then-snapshot chain. D2 needs
 * D1's freshly-settled fights to have anything to do, so running them
 * apart would just mean picks wait an extra cycle for no reason. Each
 * still gets its own job_runs row (own job name), so a failure in one
 * doesn't obscure whether the other ran.
 */
export async function runSettlementJobsOnce(supabase: SupabaseClient): Promise<SettlementJobsSummary> {
  const fights = await runWithTracking(supabase, "settle_fights", () => settleFights(supabase));
  const picks = await runWithTracking(supabase, "settle_picks", () => settlePicks(supabase));
  return { fights, picks };
}
