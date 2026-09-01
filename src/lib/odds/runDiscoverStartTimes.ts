import { getSupabaseAdmin } from "../supabase/admin";
import { fetchMmaOdds } from "./client";
import { discoverStartTimes } from "./discoverStartTimes";

// Standalone manual entry point (npm run odds:discover-start-times) --
// fetches its own odds rather than sharing a call, since it's meant for an
// ad hoc dry run, not the scheduled cadence. The scheduled cron
// (runScheduledOddsJob.ts, B5) fetches once and shares it with
// matchAndSnapshot instead.
async function main() {
  const supabase = getSupabaseAdmin();
  const oddsEvents = await fetchMmaOdds();
  const summary = await discoverStartTimes(supabase, oddsEvents);
  console.log(
    `Start-time discovery: ${summary.updated} events updated, ${summary.noConfidentMatch} with no confident match yet.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
