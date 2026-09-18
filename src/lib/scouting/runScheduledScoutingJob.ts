import { createMapReduceDeps } from "../llm/createMapReduceDeps";
import { describeDegradation } from "../llm/describeDegradation";
import { runWithTracking } from "../jobs/runWithTracking";
import { getSupabaseAdmin } from "../supabase/admin";
import { generateScoutingDossiers } from "./generateScoutingDossiers";

// N7's scheduled entry point. job_name "scouting_dossiers" -- free text,
// matching every other job in job_runs (0018_job_runs.sql).
async function main() {
  const supabase = getSupabaseAdmin();
  const deps = createMapReduceDeps(supabase);
  const summary = await runWithTracking(supabase, "scouting_dossiers", () =>
    generateScoutingDossiers(supabase, deps),
  );

  console.log(
    `Scouting dossiers: ${summary.fightersNeedingDossier} fighter(s) needed a fresh dossier, ` +
      `${summary.dossiersWritten} written.`,
  );

  const warning = describeDegradation(summary.degradation);
  if (warning) console.warn(`Degraded: ${warning}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
