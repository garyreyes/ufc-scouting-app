import { getSupabaseAdmin } from "../supabase/admin";
import { selectAllPages } from "../supabase/selectAllPages";
import {
  buildBacktestCase,
  buildCareerTimeline,
  splitBeforeDate,
  summarizeBacktest,
  type BacktestCase,
  type SherdogBoutRecord,
} from "./methodBacktest";

// L5: read-only. Replays every Sherdog-linked fighter's own fight history
// through both the old (weight-class-only) and new (finish-record) method
// rules, and reports which one actually predicts real outcomes better --
// see methodBacktest.ts for the pure math and DECISIONS.md for why this
// exists instead of shipping "more accurate" as a guess. Writes nothing.

interface FighterRow {
  id: string;
  sherdog_id: number;
  weight_class: string | null;
}

interface BoutRow {
  id: string;
  fighter_id: string;
  event_date: string | null;
  opponent_sherdog_id: number | null;
  result: "win" | "loss" | "draw" | "nc" | "unknown";
  method: string | null;
}

async function loadData() {
  const supabase = getSupabaseAdmin();

  const { data: fighterRows, error: fighterError } = await supabase
    .from("fighters")
    .select("id, sherdog_id, weight_class")
    .not("sherdog_id", "is", null);
  if (fighterError) throw fighterError;
  const fighters = (fighterRows ?? []) as FighterRow[];

  // fighter_sherdog_bouts has no upper bound on how many bouts a linked
  // fighter carries (2,600+ rows total, well past PostgREST's page cap) --
  // selectAllPages is mandatory here, a bare .select() would silently
  // truncate and every accuracy number downstream would be wrong with no
  // error to show for it.
  const bouts = await selectAllPages<BoutRow>(
    supabase,
    "fighter_sherdog_bouts",
    "id, fighter_id, event_date, opponent_sherdog_id, result, method",
  );

  return { fighters, bouts };
}

function toRecord(bout: BoutRow): SherdogBoutRecord {
  return {
    eventDate: bout.event_date,
    opponentSherdogId: bout.opponent_sherdog_id,
    result: bout.result,
    method: bout.method,
  };
}

async function main() {
  const { fighters, bouts } = await loadData();

  const boutsByFighterId = new Map<string, BoutRow[]>();
  for (const bout of bouts) {
    const list = boutsByFighterId.get(bout.fighter_id) ?? [];
    list.push(bout);
    boutsByFighterId.set(bout.fighter_id, list);
  }

  const timelineBySherdogId = new Map<number, ReturnType<typeof buildCareerTimeline>>();
  const weightClassBySherdogId = new Map<number, string | null>();
  for (const fighter of fighters) {
    const own = (boutsByFighterId.get(fighter.id) ?? []).map(toRecord);
    timelineBySherdogId.set(fighter.sherdog_id, buildCareerTimeline(own));
    weightClassBySherdogId.set(fighter.sherdog_id, fighter.weight_class);
  }

  const cases: BacktestCase[] = [];
  for (const fighter of fighters) {
    const timeline = timelineBySherdogId.get(fighter.sherdog_id) ?? [];
    const weightClass = fighter.weight_class;
    for (const point of timeline) {
      if (point.result !== "win") continue;
      const opponentTimeline =
        point.opponentSherdogId !== null ? (timelineBySherdogId.get(point.opponentSherdogId) ?? null) : null;
      const opponentSplit = opponentTimeline !== null ? splitBeforeDate(opponentTimeline, point.eventDate) : null;
      cases.push(buildBacktestCase(point, weightClass, opponentSplit));
    }
  }

  const summary = summarizeBacktest(cases);

  console.log(`Fighters with Sherdog history: ${fighters.length}`);
  console.log(`Total decidable wins replayed: ${summary.totalCases}`);
  console.log(`  ...with a resolvable opponent record: ${summary.bothSidesCases}`);
  console.log();
  console.log(`Old rule (weight-class only) accuracy, all cases:   ${pct(summary.oldRuleAccuracy)}`);
  console.log(`"Always DECISION" baseline, all cases:              ${pct(summary.alwaysDecisionAccuracy)}`);
  console.log();
  console.log("Fair comparison -- same both-sides population for both rules:");
  console.log(`  Old rule accuracy:                                ${pct(summary.oldRuleAccuracyBothSides)}`);
  console.log(
    `  New rule accuracy, exact calls only (${summary.newRuleExactCalls}):            ${pct(summary.newRuleExactAccuracy)}`,
  );
  console.log(`New rule FINISH call rate (of both-sides cases):    ${pct(summary.finishCallRate)}`);
  console.log(`New rule FINISH hit rate (actual was KO or sub):    ${pct(summary.finishHitRate)}`);
  console.log();
  console.log(
    "Compare the old-rule line above against the exact-call line, restricted to the same both-sides " +
      "population, to judge whether the finish-record signal is worth shipping. Tune SHRINKAGE_K and " +
      "KO_VS_SUB_THRESHOLD in predictInternMethod.ts and re-run if not.",
  );

  printDiagnostics(cases);
}

// Diagnostic only, not part of the tested pure module -- a confusion
// breakdown to see WHERE a rule is wrong, not just how often.
function printDiagnostics(cases: BacktestCase[]): void {
  const bothSides = cases.filter((c) => c.bothSidesAvailable);
  console.log("\n--- Diagnostics (both-sides cases only, n=" + bothSides.length + ") ---");

  const actualCounts = new Map<string, number>();
  for (const c of bothSides) actualCounts.set(c.actual, (actualCounts.get(c.actual) ?? 0) + 1);
  console.log("Real outcome distribution:", Object.fromEntries(actualCounts));

  const oldCallCounts = new Map<string, number>();
  const newCallCounts = new Map<string, number>();
  for (const c of bothSides) {
    oldCallCounts.set(c.oldRule, (oldCallCounts.get(c.oldRule) ?? 0) + 1);
    newCallCounts.set(c.newRule, (newCallCounts.get(c.newRule) ?? 0) + 1);
  }
  console.log("Old rule call distribution:", Object.fromEntries(oldCallCounts));
  console.log("New rule call distribution:", Object.fromEntries(newCallCounts));

  console.log("\nWhen new rule called FINISH, what actually happened:");
  const finishActuals = new Map<string, number>();
  for (const c of bothSides.filter((c) => c.newRule === "FINISH")) {
    finishActuals.set(c.actual, (finishActuals.get(c.actual) ?? 0) + 1);
  }
  console.log(Object.fromEntries(finishActuals));

  console.log("\nWhen new rule called DECISION, what actually happened:");
  const decisionActuals = new Map<string, number>();
  for (const c of bothSides.filter((c) => c.newRule === "DECISION")) {
    decisionActuals.set(c.actual, (decisionActuals.get(c.actual) ?? 0) + 1);
  }
  console.log(Object.fromEntries(decisionActuals));
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
