import { runWithTracking } from "../jobs/runWithTracking";
import { getSupabaseAdmin } from "../supabase/admin";
import { resolveSherdogIdentity } from "./resolveSherdogIdentityJob";

// J3's entry point. Pass --dry-run to read + fetch everything and write
// nothing -- the intended FIRST run against production, so the summary
// (how many auto-match, how many hit the review queue, how many Sherdog
// lacks) is visible before any row changes. A dry run is NOT recorded in
// job_runs: it changed nothing, so a job-health row for it would be
// noise.
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
    ? await resolveSherdogIdentity(supabase, { dryRun: true, batchSize })
    : await runWithTracking(supabase, "sherdog_identity", () =>
        resolveSherdogIdentity(supabase, { batchSize }),
      );

  console.log(
    `Sherdog identity${dryRun ? " (DRY RUN — nothing written)" : ""}: ` +
      `${summary.attempted} attempted, ${summary.matched} auto-matched, ` +
      `${summary.queued} queued for review (${summary.guardRejected} of them after a page-name mismatch), ` +
      `${summary.noCandidates} not in Sherdog, ${summary.failed} failed.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
