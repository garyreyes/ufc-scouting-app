import { getSupabaseAdmin } from "../supabase/admin";
import { refreshRecentEventResults } from "./refreshRecentEventResults";

// L2: also runs at the tail of every schedule sync (syncSchedule.ts).
// Kept runnable on its own (`npm run sync:refresh-recent-results`) for the
// first validation pass and for any card a human wants re-pulled
// immediately. Dry-run by default -- pass --commit to actually write.
// Idempotent, safe to re-run.
async function main() {
  const commit = process.argv.includes("--commit");
  const supabase = getSupabaseAdmin();
  const summary = await refreshRecentEventResults(supabase, { dryRun: !commit });

  console.log(
    `Recent-results refresh (window from ${summary.windowEarliest}): ` +
      `${summary.candidateTitles.length} card(s) need a Wikipedia result refresh.`,
  );
  for (const title of summary.candidateTitles) console.log(`  - ${title}`);

  if (!commit) {
    console.log("\nDRY RUN -- nothing fetched or written. Re-run with --commit to refresh.");
    return;
  }

  console.log(
    `\nRefreshed ${summary.eventsRefreshed} event(s), ${summary.fightsTouched} fight rows touched, ` +
      `${summary.failed} failed.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
