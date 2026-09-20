import { createGroqMapReduceDeps } from "../llm/createGroqMapReduceDeps";
import { describeDegradation } from "../llm/describeDegradation";
import { runWithTracking } from "../jobs/runWithTracking";
import { getSupabaseAdmin } from "../supabase/admin";
import { generateShadowPicksGroq } from "./generateShadowPicksGroq";

// O3 (Track B)'s scheduled entry point. job_name "shadow_picks_groq" --
// free text, matching every other job in job_runs (0018_job_runs.sql).
// Runs on its own cron (shadow-picks.yml), alongside but independent of
// generateShadowPicks.ts's Gemini job -- DECISIONS.md, 2026-09-20:
// separate job per provider, not one script looping over both, so a
// Groq-specific budget/pacing issue never risks the Gemini line's run.
async function main() {
  const supabase = getSupabaseAdmin();
  const deps = createGroqMapReduceDeps(supabase);
  const summary = await runWithTracking(supabase, "shadow_picks_groq", () => generateShadowPicksGroq(supabase, deps));

  if (!summary.ran) {
    console.log(
      `Shadow picks (Groq): skipped (${summary.eligibleFights} eligible fight(s), no dossier change since last run or no card).`,
    );
    return;
  }

  console.log(
    `Shadow picks (Groq): ${summary.eligibleFights} eligible fight(s), ${summary.shadowPicksWritten} row(s) written.`,
  );

  const warning = summary.degradation ? describeDegradation(summary.degradation) : null;
  if (warning) console.warn(`Degraded: ${warning}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
