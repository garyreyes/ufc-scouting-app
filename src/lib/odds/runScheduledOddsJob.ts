import { getSupabaseAdmin } from "../supabase/admin";
import { runOddsJobsOnce } from "./runOddsJobsOnce";

// B5's scheduled entry point -- .github/workflows/odds.yml runs this every
// 2 hours. The actual work is runOddsJobsOnce, shared with the owner's
// manual "retry now" server action so the two never diverge.
async function main() {
  const supabase = getSupabaseAdmin();
  const { discovery, snapshot } = await runOddsJobsOnce(supabase);

  console.log(
    `Start-time discovery: ${discovery.updated} events updated, ${discovery.noConfidentMatch} with no confident match yet.`,
  );
  console.log(
    `Odds snapshot: ${snapshot.matched} matched, ${snapshot.lowConfidence} low-confidence (queued), ` +
      `${snapshot.skippedNoPrice} skipped (no price), ${snapshot.skippedAlreadySnapshotted} already snapshotted, ` +
      `${snapshot.noCandidates} with no candidates.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
