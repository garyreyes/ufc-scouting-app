import { runWithTracking } from "../jobs/runWithTracking";
import { getSupabaseAdmin } from "../supabase/admin";
import { enrichFighters } from "./enrichFighters";

// I2's scheduled entry point -- .github/workflows/fighter-enrichment.yml
// runs this. job_name "fighter_enrichment" gets its own job_runs row,
// same bookkeeping as the odds, settlement, rumour, and intern jobs.
// Once daily, not twice: this is a backfill against a fixed, slowly-
// growing population (name-only fighters landing on newly-announced
// cards), not time-sensitive the way price snapshots are, and it shares
// API-Sports' 100/day free-tier budget with the twice-daily results
// sync.
async function main() {
  const supabase = getSupabaseAdmin();
  const summary = await runWithTracking(supabase, "fighter_enrichment", () => enrichFighters(supabase));

  console.log(
    `Fighter enrichment: ${summary.attempted} attempted, ${summary.matched} matched, ` +
      `${summary.queued} queued for review, ${summary.noCandidates} not found in API-Sports, ` +
      `${summary.failed} failed.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
