import { runWithTracking } from "../jobs/runWithTracking";
import { getSupabaseAdmin } from "../supabase/admin";
import { importSherdogHistory } from "./importSherdogHistoryJob";

// J4's entry point.
//   --dry-run          fetch + parse everything, write nothing (first run)
//   --refresh          re-import already-stored fighters, oldest first
//   --sherdog-id=<n>   re-import exactly one fighter
//   --batch=<n>        cap the batch (default 60)
function numericArg(prefix: string): number | undefined {
  const arg = process.argv.find((a) => a.startsWith(prefix));
  if (!arg) return undefined;
  const n = Number(arg.slice(prefix.length));
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const refresh = process.argv.includes("--refresh");
  const batchSize = numericArg("--batch=");
  const sherdogId = numericArg("--sherdog-id=");

  const supabase = getSupabaseAdmin();
  const opts = { dryRun, refresh, batchSize, sherdogId };

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
