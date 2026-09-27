import { runWithTracking } from "../../jobs/runWithTracking";
import { getSupabaseAdmin } from "../../supabase/admin";
import { generateInternSlate, type InternSlateSummary } from "./generateInternSlate";

// Phase T4's scheduled entry point -- intern.yml runs this right after the
// picks step. `--dry-run` prints the slate it WOULD write and writes
// nothing, not even a job_runs row.
function printSlate(summary: InternSlateSummary, dryRun: boolean): void {
  const prefix = dryRun ? "[dry-run] " : "";
  if (summary.eventId === null) return console.log(`${prefix}Intern slate: no upcoming card.`);
  if (summary.frozen) return console.log(`${prefix}Intern slate: card is inside the T-6h lock -- slate frozen.`);
  console.log(
    `${prefix}Intern slate: balance ₱${summary.balancePhp.toFixed(2)}, budget ₱${summary.budgetPhp.toFixed(2)}, ` +
      `staked ₱${summary.stakedPhp} across ${summary.slate.length} slip(s)` +
      (summary.unchanged ? " (unchanged)." : dryRun ? "." : `, ${summary.slipsReplaced} replaced.`),
  );
  for (const s of summary.slate) {
    console.log(`  ${s.archetype} #${s.index}  ₱${s.stakePhp} @ ${s.combinedPrice}  (model P ${(s.modelProbability * 100).toFixed(1)}%)`);
    for (const l of s.legs) console.log(`    - ${l.selectionDetail} @ ${l.price}${l.priceSource === "book" ? "" : ` (${l.priceSource === "estimated" ? "est." : "entered"})`}`);
  }
}

async function main() {
  const supabase = getSupabaseAdmin();
  const dryRun = process.argv.includes("--dry-run");
  const summary = dryRun
    ? await generateInternSlate(supabase, { dryRun })
    : await runWithTracking(supabase, "intern_slate", () => generateInternSlate(supabase));
  printSlate(summary, dryRun);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
