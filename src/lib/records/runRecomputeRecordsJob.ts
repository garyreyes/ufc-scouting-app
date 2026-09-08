import { runWithTracking } from "../jobs/runWithTracking";
import { getSupabaseAdmin } from "../supabase/admin";
import { recomputeFighterRecords } from "./recomputeFighterRecords";

// Records normally recompute as the last step of the settlement chain
// (runSettlementJobsOnce.ts). This standalone entry point exists for
// running the recount on its own -- after a Sherdog history import (J4)
// changes which fighters are Sherdog-sourced, without waiting for the
// next settlement run. Same job_runs name ("recompute_records") so a
// manual run and a scheduled one show up the same way.
async function main() {
  const supabase = getSupabaseAdmin();
  const summary = await runWithTracking(supabase, "recompute_records", () =>
    recomputeFighterRecords(supabase),
  );

  console.log(
    `Record recompute: ${summary.fightsCounted} fights read, ${summary.fightersUpdated} fighter records changed, ` +
      `${summary.sherdogSourced} sourced from Sherdog.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
