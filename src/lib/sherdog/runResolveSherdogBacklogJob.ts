import { runWithTracking } from "../jobs/runWithTracking";
import { getSupabaseAdmin } from "../supabase/admin";
import { resolveHistoricalSherdogBacklog } from "./resolveSherdogIdentityJob";

// P10's entry point (ROADMAP_V2.md Phase P) -- the historical spine, not
// the daily upcoming-card queue (that's runResolveSherdogIdentityJob.ts).
// Same --dry-run/--batch= contract as that job. A dry run is NOT recorded
// in job_runs, same reasoning: it changed nothing.
function parseBatch(): number | undefined {
  const arg = process.argv.find((a) => a.startsWith("--batch="));
  if (!arg) return undefined;
  const n = Number(arg.slice("--batch=".length));
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const batchSize = parseBatch();
  const supabase = getSupabaseAdmin();

  const summary = dryRun
    ? await resolveHistoricalSherdogBacklog(supabase, { dryRun: true, batchSize })
    : await runWithTracking(supabase, "sherdog_backlog", () =>
        resolveHistoricalSherdogBacklog(supabase, { batchSize }),
      );

  console.log(
    `Sherdog historical backlog${dryRun ? " (DRY RUN — nothing written)" : ""}: ` +
      `${summary.attempted} attempted, ${summary.matched} auto-matched ` +
      `(${summary.historyMatched} via history corroboration), ` +
      `${summary.queued} queued for review (${summary.guardRejected} of them after a page-name mismatch), ` +
      `${summary.noCandidates} not in Sherdog, ${summary.failed} failed.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
