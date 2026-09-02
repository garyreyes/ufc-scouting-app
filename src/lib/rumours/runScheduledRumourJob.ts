import { runWithTracking } from "../jobs/runWithTracking";
import { getSupabaseAdmin } from "../supabase/admin";
import { runRumourScanJob } from "./runRumourScanJob";

// F2's scheduled entry point -- .github/workflows/rumours.yml runs this.
// job_name "rumour_scan" is what the future job-health banner (F3) reads
// "last scraped X" from, and what a heuristic-fallback run shows up in.
async function main() {
  const supabase = getSupabaseAdmin();
  const summary = await runWithTracking(supabase, "rumour_scan", () => runRumourScanJob(supabase));

  console.log(
    `Rumour scan: event ${summary.eventId ?? "(none upcoming)"}, ${summary.fightsScanned} fights scanned ` +
      `(${summary.llmFights} via LLM, ${summary.heuristicFallbackFights} heuristic fallback, ` +
      `${summary.skippedNoPosts} skipped, ${summary.failedFights} failed), ` +
      `${summary.flagsWritten} flags written, ${summary.sourcesWritten} sources written.`,
  );

  if (summary.heuristicFallbackFights > 0) {
    console.warn(
      `Degraded: ${summary.heuristicFallbackFights} fight(s) fell back to heuristic clustering this run.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
