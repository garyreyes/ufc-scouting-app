import { runWithTracking } from "../jobs/runWithTracking";
import { getSupabaseAdmin } from "../supabase/admin";
import { generateInternPicks } from "./generateInternPicks";

// G1's scheduled entry point -- .github/workflows/intern.yml runs this.
// job_name "intern_picks" gets its own job_runs row, same bookkeeping as
// the odds, settlement, and rumour jobs.
async function main() {
  const supabase = getSupabaseAdmin();
  const summary = await runWithTracking(supabase, "intern_picks", () => generateInternPicks(supabase));

  console.log(
    `Intern picks: ${summary.fightsConsidered} fights considered, ` +
      `${summary.picksWritten} written, ${summary.picksUnchanged} unchanged, ` +
      `${summary.unpricedPicks} unpriced (anchored at even odds), ` +
      `${summary.skippedConflict} held by a conflict, ${summary.skippedLocked} already locked, ` +
      `${summary.failed} failed.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
