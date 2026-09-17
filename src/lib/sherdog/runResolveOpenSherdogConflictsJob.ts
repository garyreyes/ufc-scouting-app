import { runWithTracking } from "../jobs/runWithTracking";
import { getSupabaseAdmin } from "../supabase/admin";
import { resolveOpenSherdogConflicts } from "./resolveOpenSherdogConflictsJob";

// M5's entry point. Pass --dry-run to read + fetch everything and write
// nothing -- run this against production first, same discipline as
// resolveSherdogIdentityJob.ts's own --dry-run.
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const supabase = getSupabaseAdmin();

  const summary = dryRun
    ? await resolveOpenSherdogConflicts(supabase, { dryRun: true })
    : await runWithTracking(supabase, "sherdog_open_conflict_resolution", () =>
        resolveOpenSherdogConflicts(supabase),
      );

  console.log(
    `Sherdog open-conflict resolution${dryRun ? " (DRY RUN — nothing written)" : ""}: ` +
      `${summary.checked} checked, ${summary.resolved} auto-resolved, ${summary.failed} failed.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
