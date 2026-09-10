import { getSupabaseAdmin } from "../supabase/admin";
import { applySherdogResults } from "./applySherdogResults";

// J7: normally runs inside runSettlementJobsOnce. Kept runnable on its
// own (`npm run sherdog:apply-results`, `--dry-run`) for the first live
// verification pass -- point it at already-settled fights and confirm
// its derived winner matches `winner_id` before letting it into the
// settlement chain for real.
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const supabase = getSupabaseAdmin();
  const summary = await applySherdogResults(supabase, { dryRun });

  console.log(
    `applySherdogResults${dryRun ? " (dry-run)" : ""}: ` +
      `${summary.fightsChecked} both-linked fights checked, ${summary.matched} matched, ` +
      `${summary.written} ${dryRun ? "would be written" : "written"}, ` +
      `${summary.ambiguous} ambiguous, ${summary.noData} no data.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
