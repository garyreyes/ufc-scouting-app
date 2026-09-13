import { runWithTracking } from "../jobs/runWithTracking";
import { getSupabaseAdmin } from "../supabase/admin";
import { resolveSameCardNameVariants } from "./resolveSameCardNameVariants";

// M3's entry point. Pass --dry-run to read everything and merge nothing --
// the intended FIRST run against production, so the summary (how many
// would merge, how many hit a real guard) is visible before any fighter
// row is ever deleted. A dry run is NOT recorded in job_runs, same
// convention as sherdog:resolve-identity's own --dry-run.
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const supabase = getSupabaseAdmin();

  const summary = dryRun
    ? await resolveSameCardNameVariants(supabase, { dryRun: true })
    : await runWithTracking(supabase, "resolve_same_card_name_variants", () =>
        resolveSameCardNameVariants(supabase),
      );

  console.log(
    `Same-card name variant sweep${dryRun ? " (DRY RUN — nothing written)" : ""}: ` +
      `${summary.conflictsChecked} open disputed_opponent conflicts checked, ` +
      `${summary.merged} merged, ${summary.skippedNotVariant} not a recognized variant, ` +
      `${summary.skippedConflictingSherdogIds} skipped (conflicting Sherdog identities).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
