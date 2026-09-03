import { runWithTracking } from "../jobs/runWithTracking";
import { getSupabaseAdmin } from "../supabase/admin";
import { backfillFightHistory } from "./backfillFightHistory";

// I3's scheduled entry point -- .github/workflows/fight-history-backfill.yml
// runs this. job_name "fight_history_backfill" gets its own job_runs row,
// same bookkeeping as every other batch job.
async function main() {
  const supabase = getSupabaseAdmin();
  const summary = await runWithTracking(supabase, "fight_history_backfill", () => backfillFightHistory(supabase));

  console.log(
    `Fight history backfill: ${summary.fightersAttempted} fighters attempted, ` +
      `${summary.eventsWritten} events written, ${summary.fightersWritten} fighter records touched, ` +
      `${summary.fightsWritten} fights written, ${summary.failed} failed.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
