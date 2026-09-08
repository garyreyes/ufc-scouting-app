import { runWithTracking } from "../jobs/runWithTracking";
import { getSupabaseAdmin } from "../supabase/admin";
import { importSherdogHistory } from "./importSherdogHistoryJob";

// J4's entry point. --dry-run fetches + parses everything and writes
// nothing (the intended first run). --refresh re-imports fighters whose
// history is already stored, for when a Sherdog page has changed.
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const refresh = process.argv.includes("--refresh");
  const batchArg = process.argv.find((a) => a.startsWith("--batch="));
  const batchSize = batchArg ? Number(batchArg.slice("--batch=".length)) : undefined;

  const supabase = getSupabaseAdmin();
  const opts = { dryRun, refresh, batchSize };

  const summary = dryRun
    ? await importSherdogHistory(supabase, opts)
    : await runWithTracking(supabase, "sherdog_history_import", () => importSherdogHistory(supabase, opts));

  console.log(
    `Sherdog history import${dryRun ? " (DRY RUN — nothing written)" : ""}: ` +
      `${summary.attempted} attempted, ${summary.imported} imported (${summary.boutsWritten} bouts), ` +
      `${summary.skipped} skipped (cross-check), ${summary.guardRejected} guard-rejected, ` +
      `${summary.finishNulled} with an unreconciled finish breakdown, ${summary.failed} failed.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
