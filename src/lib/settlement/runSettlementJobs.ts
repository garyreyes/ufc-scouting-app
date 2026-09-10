import { getSupabaseAdmin } from "../supabase/admin";
import { runSettlementJobsOnce } from "./runSettlementJobsOnce";

// D1 + D2's scheduled entry point -- .github/workflows/sync.yml runs this
// after both sync jobs, on the same twice-daily cadence, since it needs
// their freshly-written per-source reports to have anything to evaluate.
async function main() {
  const supabase = getSupabaseAdmin();
  const { sherdogReimport, sherdogResults, fights, picks, elo, records } =
    await runSettlementJobsOnce(supabase);

  console.log(
    `Sherdog re-import: ${sherdogReimport.pendingFights} pending fights, ` +
      `${sherdogReimport.fightersReimported} fighters refreshed (cap ${sherdogReimport.cappedAt}).`,
  );
  console.log(
    `Sherdog results: ${sherdogResults.fightsChecked} both-linked fights checked, ` +
      `${sherdogResults.matched} matched, ${sherdogResults.written} written, ${sherdogResults.ambiguous} ambiguous.`,
  );
  console.log(
    `Fight settlement: ${fights.settled} settled, ${fights.conflicts} disputed (queued), ` +
      `${fights.stillWaiting} still waiting, ${fights.resultDisputesResolved} prior disputes auto-resolved.`,
  );
  console.log(`Pick settlement: ${picks.picksSettled} picks settled across ${picks.fightsProcessed} fights.`);
  console.log(
    `Elo recompute: ${elo.fightsProcessed} settled fights processed, ${elo.snapshotsWritten} rating snapshots written.`,
  );
  console.log(
    // "fights read" and Elo's "fights processed" above are deliberately
    // different populations -- this one is every row in the table before
    // any resolution filter is applied, not just the decisive ones -- so
    // this is worded to not look like a mismatched pair of the same number.
    `Record recompute: ${records.fightsCounted} fights read, ${records.fightersUpdated} fighter records changed, ` +
      `${records.sherdogSourced} sourced from Sherdog.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
