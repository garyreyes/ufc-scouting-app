import { runWithTracking } from "../jobs/runWithTracking";
import { getSupabaseAdmin } from "../supabase/admin";
import { backfillWikipediaHistory } from "./backfillWikipediaHistory";

// I4's scheduled entry point -- .github/workflows/wikipedia-history-backfill.yml
// runs this. job_name "wikipedia_history_backfill" gets its own job_runs
// row, same bookkeeping as every other batch job. Finite work: once
// candidateEvents reaches 0 for several runs the backfill has caught up
// and each run just re-checks the year categories for anything newly past.
async function main() {
  const supabase = getSupabaseAdmin();
  const summary = await runWithTracking(supabase, "wikipedia_history_backfill", () =>
    backfillWikipediaHistory(supabase),
  );

  console.log(
    `Wikipedia history backfill: ${summary.candidateEvents} in queue, ${summary.eventsAttempted} attempted, ` +
      `${summary.eventsWritten} events written, ${summary.fightsWritten} fights written ` +
      `(${summary.skippedUpcoming} upcoming, ${summary.skippedUndated} undated, ${summary.failed} failed).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
