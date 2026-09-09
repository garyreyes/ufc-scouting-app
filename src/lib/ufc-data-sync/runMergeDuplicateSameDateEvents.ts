import { getSupabaseAdmin } from "../supabase/admin";
import { mergeDuplicateSameDateEvents } from "./mergeDuplicateSameDateEvents";

// K1: also runs automatically at the end of every schedule sync
// (syncSchedule.ts). Kept runnable on its own
// (`npm run events:merge-duplicates`) for the first cleanup pass and for
// any future duplicate that a human wants to resolve immediately rather
// than wait for the next cron. Idempotent -- safe to re-run.
async function main() {
  const supabase = getSupabaseAdmin();
  const summary = await mergeDuplicateSameDateEvents(supabase);

  console.log(
    `Duplicate-event merge: ${summary.eventsScanned} live events scanned, ` +
      `${summary.duplicateClustersMerged} clusters merged, ` +
      `${summary.loserEventsMerged} events folded, ${summary.fightsDeleted} duplicate fights deleted, ` +
      `${summary.eloRowsCleared} elo history rows cleared` +
      `${summary.eloRecomputed ? " (Elo recomputed)" : ""}, ` +
      `${summary.skipped.length} clusters skipped (manual review).`,
  );
  for (const cluster of summary.skipped) {
    console.log(`  Skipped ${cluster.event_date} [${cluster.eventIds.join(", ")}]: ${cluster.reason}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
