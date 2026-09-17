import { predictInternMethod } from "./predictInternMethod";
import type { FinishSplit } from "./predictInternMethod";
import type { FightMethod } from "../scoring/fightMethod";

// L5: replays real Sherdog history to check whether the finish-record
// signal actually beats the old weight-class-only rule, instead of
// shipping "more accurate" as an unmeasured claim -- same failure mode
// PROJECT_FACTS.md already flagged for the pre-L5 rule. Pure and
// synchronous; runMethodBacktest.ts does the I/O (paging
// fighter_sherdog_bouts) and hands rows in here.

// One fighter's raw bout row, oldest-first order not required -- callers
// pass whatever order the query returned; buildCareerTimeline sorts.
export interface SherdogBoutRecord {
  eventDate: string | null; // "YYYY-MM-DD"; a bout with no date can't be
  // placed in a chronological timeline and is dropped.
  opponentSherdogId: number | null;
  result: "win" | "loss" | "draw" | "nc" | "unknown";
  method: string | null; // Sherdog's own text, e.g. "TKO (punches)"
}

export type DecidableMethod = Exclude<FightMethod, "FINISH">;

const EMPTY_SPLIT: FinishSplit = { winsKo: 0, winsSub: 0, winsDec: 0, lossesKo: 0, lossesSub: 0, lossesDec: 0 };

/**
 * Sherdog's own method text -> one of the three real outcomes a fight can
 * actually resolve to. A draw, no contest, or disqualification isn't a
 * method-of-victory at all, and an unrecognized string is safer to drop
 * than to guess -- both return null, and the caller excludes the bout.
 *
 * Order matters: "Technical Decision" and "Technical Submission" both
 * contain their real class as a substring, so checking `includes` for
 * "decision" and "submission" before falling back to the KO/TKO prefix
 * check classifies them correctly without a separate special case.
 */
export function classifySherdogMethod(method: string | null): DecidableMethod | null {
  if (method === null) return null;
  const lower = method.toLowerCase();
  if (lower.includes("decision")) return "DECISION";
  if (lower.includes("submission")) return "SUBMISSION";
  if (lower.startsWith("ko") || lower.startsWith("tko") || lower.includes("knockout")) return "KO_TKO";
  return null;
}

function addToSplit(split: FinishSplit, method: DecidableMethod, side: "win" | "loss"): FinishSplit {
  const key =
    side === "win"
      ? (method === "KO_TKO" ? "winsKo" : method === "SUBMISSION" ? "winsSub" : "winsDec")
      : method === "KO_TKO"
        ? "lossesKo"
        : method === "SUBMISSION"
          ? "lossesSub"
          : "lossesDec";
  return { ...split, [key]: split[key] + 1 };
}

export interface TimelineCase {
  eventDate: string;
  result: "win" | "loss";
  actualMethod: DecidableMethod;
  opponentSherdogId: number | null;
  // The fighter's own record from every EARLIER decidable bout only --
  // never including this one or anything later. This is what makes the
  // backtest leakage-free.
  splitBefore: FinishSplit;
}

/**
 * One fighter's chronological record. Bouts with no event date, or a
 * method that doesn't classify (draw / NC / DQ / unrecognized), are
 * skipped entirely -- they neither become a test case nor advance the
 * running split, since they're not a real KO/sub/dec outcome.
 */
export function buildCareerTimeline(bouts: SherdogBoutRecord[]): TimelineCase[] {
  const decidable = bouts
    .filter((b): b is SherdogBoutRecord & { eventDate: string } => b.eventDate !== null)
    .filter((b) => b.result === "win" || b.result === "loss")
    .map((b) => ({ ...b, actualMethod: classifySherdogMethod(b.method) }))
    .filter((b): b is typeof b & { actualMethod: DecidableMethod } => b.actualMethod !== null)
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate));

  const timeline: TimelineCase[] = [];
  let running = EMPTY_SPLIT;
  for (const bout of decidable) {
    timeline.push({
      eventDate: bout.eventDate,
      result: bout.result as "win" | "loss",
      actualMethod: bout.actualMethod,
      opponentSherdogId: bout.opponentSherdogId,
      splitBefore: running,
    });
    running = addToSplit(running, bout.actualMethod, bout.result as "win" | "loss");
  }
  return timeline;
}

/**
 * The opponent's own pre-fight LOSS-relevant record, as of just before
 * `beforeDate` -- found by looking at what THAT fighter's own timeline
 * (their wins/losses, not filtered to just losses) had accumulated
 * strictly before this date. Returns null if the opponent has no
 * Sherdog timeline at all (not a linked fighter, or no decidable bouts).
 *
 * This is an approximation, not an exact bout-for-bout match: it doesn't
 * require locating the opponent's own row for this specific fight, only
 * that the opponent's OWN chronological record be filtered to strictly
 * before this fight's date. Still leakage-free -- nothing after the fight
 * is ever used.
 */
export function splitBeforeDate(opponentTimeline: TimelineCase[], beforeDate: string): FinishSplit | null {
  if (opponentTimeline.length === 0) return null;
  let latest: FinishSplit | null = null;
  for (const point of opponentTimeline) {
    if (point.eventDate >= beforeDate) break; // timelines are sorted ascending
    latest = addToSplit(point.splitBefore, point.actualMethod, point.result);
  }
  return latest ?? EMPTY_SPLIT;
}

export interface BacktestCase {
  actual: DecidableMethod;
  oldRule: FightMethod;
  newRule: FightMethod;
  bothSidesAvailable: boolean;
}

// Held constant across every historical case: real market odds don't
// exist for most Sherdog-only bouts, so the backtest isolates the
// finish-record signal rather than trying to also reconstruct
// lopsidedness. 0.6 is a modest, unremarkable favourite -- deliberately
// not near either extreme.
const BACKTEST_PROBABILITY = 0.6;

/**
 * One backtest case per decidable win in `timeline`. `pickedSplit` is that
 * win's own pre-fight record (splitBefore, already leakage-free);
 * `opponentSplit` is resolved by the caller via `splitBeforeDate` against
 * the opponent's OWN timeline and passed in per-case, since only the
 * caller (which holds every fighter's timeline) can look that up.
 */
export function buildBacktestCase(
  win: TimelineCase,
  weightClass: string | null,
  opponentSplit: FinishSplit | null,
): BacktestCase {
  const oldRule = predictInternMethod(BACKTEST_PROBABILITY, weightClass, null, null);
  const newRule = predictInternMethod(BACKTEST_PROBABILITY, weightClass, win.splitBefore, opponentSplit);
  return {
    actual: win.actualMethod,
    oldRule: oldRule.method,
    newRule: newRule.method,
    bothSidesAvailable: opponentSplit !== null,
  };
}

export interface MethodBacktestSummary {
  totalCases: number;
  bothSidesCases: number;
  oldRuleAccuracy: number; // over ALL cases
  // Old rule restricted to the SAME both-sides population newRuleExactAccuracy
  // is measured over -- the fair, apples-to-apples comparison. The
  // all-cases number above exists only for context (most fights the
  // intern covers have data on both sides -- see the live coverage check
  // in DECISIONS.md).
  oldRuleAccuracyBothSides: number;
  alwaysDecisionAccuracy: number;
  // Among bothSidesCases only, excluding FINISH calls from the
  // denominator -- FINISH is scored separately below so it can't inflate
  // (or be penalized into) an "accuracy" number that doesn't apply to it.
  newRuleExactAccuracy: number;
  newRuleExactCalls: number;
  finishCallRate: number;
  finishHitRate: number; // among FINISH calls, fraction where actual was KO_TKO or SUBMISSION
}

export function summarizeBacktest(cases: BacktestCase[]): MethodBacktestSummary {
  const bothSides = cases.filter((c) => c.bothSidesAvailable);
  const finishCalls = bothSides.filter((c) => c.newRule === "FINISH");
  const exactCalls = bothSides.filter((c) => c.newRule !== "FINISH");
  const finishHits = finishCalls.filter((c) => c.actual === "KO_TKO" || c.actual === "SUBMISSION");

  const rate = (hits: number, n: number) => (n === 0 ? 0 : hits / n);

  return {
    totalCases: cases.length,
    bothSidesCases: bothSides.length,
    oldRuleAccuracy: rate(
      cases.filter((c) => c.oldRule === c.actual).length,
      cases.length,
    ),
    oldRuleAccuracyBothSides: rate(
      bothSides.filter((c) => c.oldRule === c.actual).length,
      bothSides.length,
    ),
    alwaysDecisionAccuracy: rate(cases.filter((c) => c.actual === "DECISION").length, cases.length),
    newRuleExactAccuracy: rate(
      exactCalls.filter((c) => c.newRule === c.actual).length,
      exactCalls.length,
    ),
    newRuleExactCalls: exactCalls.length,
    finishCallRate: rate(finishCalls.length, bothSides.length),
    finishHitRate: rate(finishHits.length, finishCalls.length),
  };
}
