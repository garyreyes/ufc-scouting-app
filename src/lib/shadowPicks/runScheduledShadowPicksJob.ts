import { createMapReduceDeps } from "../llm/createMapReduceDeps";
import { describeDegradation } from "../llm/describeDegradation";
import { runWithTracking } from "../jobs/runWithTracking";
import { getSupabaseAdmin } from "../supabase/admin";
import { generateShadowPicks } from "./generateShadowPicks";

// N8's scheduled entry point. job_name "shadow_picks" -- free text,
// matching every other job in job_runs (0018_job_runs.sql). Runs on its
// own cron (shadow-picks.yml), decoupled from scouting.yml (DECISIONS.md,
// 2026-09-18, "N8: shadow-picks job runs on its own cron").
async function main() {
  const supabase = getSupabaseAdmin();
  const deps = createMapReduceDeps(supabase);
  const summary = await runWithTracking(supabase, "shadow_picks", () => generateShadowPicks(supabase, deps));

  if (!summary.ran) {
    console.log(
      `Shadow picks: skipped (${summary.eligibleFights} eligible fight(s), no dossier change since last run or no card).`,
    );
    return;
  }

  console.log(`Shadow picks: ${summary.eligibleFights} eligible fight(s), ${summary.shadowPicksWritten} row(s) written.`);

  const warning = summary.degradation ? describeDegradation(summary.degradation) : null;
  if (warning) console.warn(`Degraded: ${warning}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
