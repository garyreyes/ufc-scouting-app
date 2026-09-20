import { runWithTracking } from "../jobs/runWithTracking";
import { getSupabaseAdmin } from "../supabase/admin";
import { runIntegritySweep } from "./runIntegritySweepJob";

// P8's entry point. Unlike the Sherdog identity job, there's no
// meaningful --dry-run here: every write this job makes is either a
// data_conflicts row an owner reviews (I1), a mechanical close of a row
// already proven redundant by other logic (I4/I6), or a self-healing
// integrity_alerts row with no downstream consequence (I2/I3/I5) -- none
// of it is destructive or hard to undo the way a bulk fighter merge would
// be.
async function main() {
  const supabase = getSupabaseAdmin();

  const summary = await runWithTracking(supabase, "integrity_sweep", () => runIntegritySweep(supabase));

  console.log(
    `Integrity sweep: ${summary.structuralDuplicatesOpened} structural duplicate fighter pair(s) opened for review, ` +
      `${summary.missingSherdogChecksOpened} missing-Sherdog-check alert(s) opened ` +
      `(${summary.missingSherdogChecksClosed} closed), ` +
      `${summary.unpricedUnconflictedOpened} unpriced-and-unconflicted-fight alert(s) opened ` +
      `(${summary.unpricedUnconflictedClosed} closed), ` +
      `${summary.staleConflictsOpened} stale-conflict alert(s) opened (${summary.staleConflictsClosed} closed), ` +
      `${summary.staleLowConfidenceClosed} stale low-confidence match(es) auto-closed (I4), ` +
      `${summary.duplicateOddsConflictsClosed} duplicate odds conflict(s) auto-closed (I6).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
