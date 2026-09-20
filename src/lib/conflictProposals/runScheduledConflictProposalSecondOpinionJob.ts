import { createGroqMapReduceDeps } from "../llm/createGroqMapReduceDeps";
import { describeDegradation } from "../llm/describeDegradation";
import { runWithTracking } from "../jobs/runWithTracking";
import { getSupabaseAdmin } from "../supabase/admin";
import { proposeSherdogMatchesSecondOpinion } from "./proposeSherdogMatchesSecondOpinion";

// Phase 2 (Track A)'s scheduled entry point. job_name
// "conflict_proposals_second_opinion" -- free text, matching every other
// job in job_runs (see 0018_job_runs.sql). Runs after
// runScheduledConflictProposalJob.ts (N4) in sherdog.yml so there is
// always a live primary proposal to annotate, never ahead of it.
async function main() {
  const supabase = getSupabaseAdmin();
  const deps = createGroqMapReduceDeps(supabase);
  const summary = await runWithTracking(supabase, "conflict_proposals_second_opinion", () =>
    proposeSherdogMatchesSecondOpinion(supabase, deps),
  );

  console.log(
    `Conflict proposals second opinion: ${summary.conflictsChecked} conflict(s) with a live primary proposal checked, ` +
      `${summary.secondOpinionsWritten} second opinion(s) written.`,
  );

  const warning = describeDegradation(summary.degradation);
  if (warning) console.warn(`Degraded: ${warning}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
