import { getSupabaseAdmin } from "../supabase/admin";
import { sweepLatentDisputedOpponents } from "./sweepLatentDisputedOpponents";

// I2c: a one-time backfill, not a scheduled job -- see
// sweepLatentDisputedOpponents.ts's own comment for why. Kept runnable
// (`npm run fights:sweep-disputed-opponents`) rather than deleted after
// its first use, in case a future sync bug produces the same shape of
// pre-existing duplicate again; safe to re-run (idempotent by
// construction -- a resolved or already-open conflict is skipped, and an
// already-deleted candidate row simply won't appear in a repeat sweep).
async function main() {
  const supabase = getSupabaseAdmin();
  const summary = await sweepLatentDisputedOpponents(supabase);

  console.log(
    `Disputed-opponent sweep: ${summary.fightsChecked} fights checked, ` +
      `${summary.clustersFound} clusters found, ${summary.pairsResolved} pairs resolved into conflicts, ` +
      `${summary.eloRowsClearedForDeletedFights} elo history rows cleared for deleted fights, ` +
      `${summary.multiWayClustersSkipped.length} multi-way clusters skipped (need manual review).`,
  );
  for (const cluster of summary.multiWayClustersSkipped) {
    console.log(`  Skipped cluster: ${cluster.fightIds.join(", ")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
