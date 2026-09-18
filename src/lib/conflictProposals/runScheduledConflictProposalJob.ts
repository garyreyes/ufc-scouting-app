import { createMapReduceDeps } from "../llm/createMapReduceDeps";
import { describeDegradation } from "../llm/describeDegradation";
import { runWithTracking } from "../jobs/runWithTracking";
import { getSupabaseAdmin } from "../supabase/admin";
import { proposeSherdogMatches } from "./proposeSherdogMatches";

// N4's scheduled entry point. job_name "conflict_proposals" -- free text,
// matching every other job in job_runs (see 0018_job_runs.sql's own
// comment on why it isn't an enum).
async function main() {
  const supabase = getSupabaseAdmin();
  const deps = createMapReduceDeps(supabase);
  const summary = await runWithTracking(supabase, "conflict_proposals", () => proposeSherdogMatches(supabase, deps));

  console.log(
    `Conflict proposals: ${summary.conflictsChecked} open Sherdog-match conflict(s) checked, ` +
      `${summary.proposalsWritten} proposal(s) written.`,
  );

  const warning = describeDegradation(summary.degradation);
  if (warning) console.warn(`Degraded: ${warning}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
