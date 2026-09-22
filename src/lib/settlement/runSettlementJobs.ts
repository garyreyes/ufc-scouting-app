import { getSupabaseAdmin } from "../supabase/admin";
import { runSettlementJobsOnce } from "./runSettlementJobsOnce";

// D1 + D2's scheduled entry point -- .github/workflows/sync.yml runs this
// after both sync jobs, on the same twice-daily cadence, since it needs
// their freshly-written per-source reports to have anything to evaluate.
// M4: .github/workflows/settle.yml also runs this, hourly on weekends,
// standalone (no sync step first) -- it only re-evaluates whatever the
// two syncs already wrote, so a 24h single-source timeout doesn't have
// to wait for sync.yml's next twice-daily run to actually fire.
//
//   --sherdog-reimport-cap=<n>   raise reimportSherdogForPendingFights.ts's
//                                per-run cap (default 12) -- settle.yml
//                                passes a higher number since it has no
//                                sync step competing for its time budget.
function numericArg(prefix: string): number | undefined {
  const arg = process.argv.find((a) => a.startsWith(prefix));
  if (!arg) return undefined;
  const n = Number(arg.slice(prefix.length));
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

async function main() {
  const sherdogReimportMaxFighters = numericArg("--sherdog-reimport-cap=");
  const supabase = getSupabaseAdmin();
  const { sherdogReimport, sherdogResults, fights, picks, betSlips, elo, records } = await runSettlementJobsOnce(
    supabase,
    { sherdogReimportMaxFighters },
  );

  console.log(
    `Sherdog re-import: ${sherdogReimport.pendingFights} pending fights, ` +
      `${sherdogReimport.fightersReimported} fighters refreshed (cap ${sherdogReimport.cappedAt}).`,
  );
  console.log(
    `Sherdog results: ${sherdogResults.fightsChecked} both-linked fights checked, ` +
      `${sherdogResults.matched} matched, ${sherdogResults.written} written, ` +
      `${sherdogResults.retracted} retracted, ${sherdogResults.ambiguous} ambiguous, ` +
      `${sherdogResults.errors} write errors.`,
  );
  console.log(
    `Fight settlement: ${fights.settled} settled, ${fights.conflicts} disputed (queued), ` +
      `${fights.stillWaiting} still waiting, ${fights.resultDisputesResolved} prior disputes auto-resolved.`,
  );
  console.log(`Pick settlement: ${picks.picksSettled} picks settled across ${picks.fightsProcessed} fights.`);
  console.log(`Bet slip settlement: ${betSlips.slipsSettled} slips settled, ${betSlips.legsSettled} legs decided.`);
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
