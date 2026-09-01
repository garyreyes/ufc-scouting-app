import { getSupabaseAdmin } from "../supabase/admin";
import { runWithTracking } from "../jobs/runWithTracking";
import { settleFights } from "./settleFights";

// D1's scheduled entry point -- .github/workflows/sync.yml runs this
// after both sync jobs, on the same twice-daily cadence, since it needs
// their freshly-written per-source reports to have anything to evaluate.
async function main() {
  const supabase = getSupabaseAdmin();
  const summary = await runWithTracking(supabase, "settle_fights", () => settleFights(supabase));

  console.log(
    `Settlement: ${summary.settled} settled, ${summary.conflicts} disputed (queued), ${summary.stillWaiting} still waiting.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
