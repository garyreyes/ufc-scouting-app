import type { SupabaseClient } from "@supabase/supabase-js";
import { runWithTracking } from "../jobs/runWithTracking";
import { recomputeEloRatings, type RecomputeEloSummary } from "../elo/recomputeEloRatings";
import { recomputeFighterRecords, type RecomputeRecordsSummary } from "../records/recomputeFighterRecords";
import {
  reimportSherdogForPendingFights,
  type ReimportPendingSummary,
} from "../sherdog/reimportSherdogForPendingFights";
import { applySherdogResults, type ApplySherdogResultsSummary } from "../sherdog/applySherdogResults";
import { settleFights, type SettleFightsSummary } from "./settleFights";
import { settlePicks, type SettlePicksSummary } from "./settlePicks";

export interface SettlementJobsSummary {
  sherdogReimport: ReimportPendingSummary;
  sherdogResults: ApplySherdogResultsSummary;
  fights: SettleFightsSummary;
  picks: SettlePicksSummary;
  elo: RecomputeEloSummary;
  records: RecomputeRecordsSummary;
}

/**
 * J7's two Sherdog steps run first: re-fetch the Sherdog pages of
 * fighters in fights that have happened but not settled
 * (`sherdog_reimport_pending`), then read the sidecar into
 * `fights.sherdog_*` (`apply_sherdog_results`) -- so settleFights sees
 * the freshest third-source opinion in the same pass. Both are safe
 * no-ops when there is nothing pending, and both are wrapped so a
 * Sherdog outage records a job_runs failure but does NOT block the
 * settlement chain behind it -- Sherdog is a third opinion, never the
 * thing standing between a finished fight and its payout.
 *
 * Then D1, D2, an Elo recompute, and the record recount, in that order
 * and in one script -- same shape as lib/odds/runOddsJobsOnce.ts's
 * discovery-then-snapshot chain. D2 needs D1's freshly-settled fights to
 * have anything to do. The Elo recompute (G1-follow-up) belongs right
 * here too: "a new result was just discovered" is exactly the moment
 * fighter ratings need to move. The record recount (I5) rides along for
 * the same reason and reads the same graph. It runs last because nothing
 * downstream needs its output. Each step still gets its own job_runs row
 * (own job name), so a failure in one doesn't obscure whether the others
 * ran.
 */
const EMPTY_REIMPORT: ReimportPendingSummary = {
  pendingFights: 0,
  fightersReimported: 0,
  boutsWritten: 0,
  cappedAt: 0,
};
const EMPTY_SHERDOG_RESULTS: ApplySherdogResultsSummary = {
  fightsChecked: 0,
  matched: 0,
  written: 0,
  ambiguous: 0,
  noData: 0,
  dryRun: false,
};

// runWithTracking rethrows so a CI step still fails loudly. For the two
// Sherdog pre-steps we want the job_runs failure row but NOT the
// rethrow: settlement must proceed on Wikipedia + API-Sports even when
// Sherdog is unreachable.
async function runOptionalStep<T>(
  supabase: SupabaseClient,
  jobName: string,
  fallback: T,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await runWithTracking(supabase, jobName, fn);
  } catch (err) {
    console.error(`${jobName} failed -- continuing settlement without it:`, err);
    return fallback;
  }
}

export async function runSettlementJobsOnce(supabase: SupabaseClient): Promise<SettlementJobsSummary> {
  const sherdogReimport = await runOptionalStep(
    supabase,
    "sherdog_reimport_pending",
    EMPTY_REIMPORT,
    () => reimportSherdogForPendingFights(supabase),
  );
  const sherdogResults = await runOptionalStep(
    supabase,
    "apply_sherdog_results",
    EMPTY_SHERDOG_RESULTS,
    () => applySherdogResults(supabase),
  );
  const fights = await runWithTracking(supabase, "settle_fights", () => settleFights(supabase));
  const picks = await runWithTracking(supabase, "settle_picks", () => settlePicks(supabase));
  const elo = await runWithTracking(supabase, "recompute_elo", () => recomputeEloRatings(supabase));
  const records = await runWithTracking(supabase, "recompute_records", () =>
    recomputeFighterRecords(supabase),
  );
  return { sherdogReimport, sherdogResults, fights, picks, elo, records };
}
