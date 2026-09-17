import type { FightMethod } from "../scoring/fightMethod";

export interface InternMethodDecision {
  method: FightMethod;
  note: string;
}

// A fighter's career finish breakdown, straight off `fighters` --
// sherdog_wins_by_ko/sub/dec and sherdog_losses_by_ko/sub/dec (0038). Only
// ever passed in when ALL SIX columns are non-null for that fighter --
// `finishSplitFrom` below is the single place that decides that.
export interface FinishSplit {
  winsKo: number;
  winsSub: number;
  winsDec: number;
  lossesKo: number;
  lossesSub: number;
  lossesDec: number;
}

interface FighterFinishRow {
  sherdog_wins_by_ko: number | null;
  sherdog_wins_by_sub: number | null;
  sherdog_wins_by_dec: number | null;
  sherdog_losses_by_ko: number | null;
  sherdog_losses_by_sub: number | null;
  sherdog_losses_by_dec: number | null;
}

/**
 * Maps a fighter row to a FinishSplit, or null if any of the six Sherdog
 * finish columns is missing. All six are written together or not at all
 * (`zeroIfClean` in buildSherdogBoutRows.ts), so partial data isn't
 * expected in practice -- this stays defensive rather than assuming that.
 */
export function finishSplitFrom(row: FighterFinishRow): FinishSplit | null {
  const {
    sherdog_wins_by_ko: winsKo,
    sherdog_wins_by_sub: winsSub,
    sherdog_wins_by_dec: winsDec,
    sherdog_losses_by_ko: lossesKo,
    sherdog_losses_by_sub: lossesSub,
    sherdog_losses_by_dec: lossesDec,
  } = row;
  if (
    winsKo === null ||
    winsSub === null ||
    winsDec === null ||
    lossesKo === null ||
    lossesSub === null ||
    lossesDec === null
  ) {
    return null;
  }
  return { winsKo, winsSub, winsDec, lossesKo, lossesSub, lossesDec };
}

// Rough UFC base rates across all divisions -- the honest starting point
// when a fighter's own Sherdog record isn't available. A stated
// assumption, and the first numbers to revisit if method predictions turn
// out badly calibrated.
const BASE = { DECISION: 0.5, KO_TKO: 0.33, SUBMISSION: 0.17 };

// The most a total mismatch can pull out of "decision" and into the
// combined finish pool. Tuned so the decision -> finish crossover sits
// around a 57% favourite for heavy divisions and a ~68% favourite for
// light ones -- real fights with a clear-but-not-huge favourite still
// go the distance often enough that a lower value would over-predict
// finishes.
const MAX_FINISH_SHIFT = 0.35;

// Of whatever finish mass a fight carries, the fraction that is KO/TKO
// rather than submission -- set by division. Heavier divisions KO;
// lighter divisions scramble and submit. Doubles as the prior used to
// shrink a real fighter's own record (below) when the sample is small.
const KO_SHARE: Record<WeightBucket, number> = { heavy: 0.85, mid: 0.62, light: 0.4 };

// L5: pseudo-fight count for shrinking a real Sherdog record toward the
// weight-class prior. A fighter with 0 recorded wins gets pure prior; a
// fighter with a long career (K or more relevant fights) is trusted close
// to their own number. First dial to turn if the backtest (methodBacktest.ts)
// finds the signal too noisy (raise K) or too timid (lower K).
const SHRINKAGE_K = 8;

// L5: how much one side's KO share of the finish pool must clear before
// the intern names KO/TKO or SUBMISSION outright, instead of the honest
// "ends early, unclear how" FINISH call. Set from methodBacktest.ts, not a
// guess -- this is the dial that decides how often FINISH fires.
const KO_VS_SUB_THRESHOLD = 0.65;

// L5: the most the fighters' own finish records can move the finish-vs-
// decision split, on top of whatever lopsidedness already contributes --
// same role as MAX_FINISH_SHIFT, deliberately smaller (0.15 vs 0.35).
// methodBacktest.ts's first live run showed why this has to be capped:
// an EARLIER, uncapped version of this rule compared the fighters'
// combined finish rate directly against decision, which is a materially
// easier bar to clear than the old rule's own test (each of KO_TKO and
// SUBMISSION individually beating DECISION, after the finish pool is
// split by weight class) -- so the uncapped version over-called finishes
// far more than real fights do (52.9% FINISH-or-named-finish calls
// against a 68-fight both-sides backtest population where only 29.4% of
// real outcomes were a finish at all, and only a 25% hit rate on those
// FINISH calls -- worse than chance). Capping the record signal to a
// bounded nudge, blending KO-vs-submission share with the weight-class
// prior instead of fully replacing it, and keeping the same "each
// candidate beats DECISION on its own" structure the old rule already
// used, is what fixed it: re-run against the same 68-fight population,
// this rule scores 74.1% exact-call accuracy against the old rule's
// 69.1%, with FINISH calls down to 20.6% of cases and a 64.3% hit rate.
// (An earlier 50/50 version of the KO-share blend below scored slightly
// higher, 75.5%, but a reviewer pass found it made SUBMISSION
// mathematically unreachable in the heavy bucket -- see
// WEIGHT_CLASS_VOTE's comment. Correctness came first.)
// See DECISIONS.md.
const MAX_RECORD_FINISH_SHIFT = 0.15;

type WeightBucket = "heavy" | "light" | "mid";

function weightBucket(weightClass: string | null): WeightBucket {
  const w = (weightClass ?? "").toLowerCase();
  // "heavyweight" also matches "light heavyweight" on purpose -- both are
  // KO-heavy divisions.
  if (w.includes("heavyweight")) return "heavy";
  if (
    w.includes("flyweight") ||
    w.includes("bantamweight") ||
    w.includes("strawweight") ||
    w.includes("women")
  ) {
    return "light";
  }
  return "mid";
}

interface ThreeWaySplit {
  dec: number;
  ko: number;
  sub: number;
}

// Shrinks a real (ko, sub, dec) count toward the weight-class prior --
// `(count + K * prior) / (n + K)`. n = 0 (no recorded fights of this kind)
// collapses to the pure prior; a long career trusts the real number.
function shrinkToward(counts: { ko: number; sub: number; dec: number }, prior: ThreeWaySplit): ThreeWaySplit {
  const n = counts.ko + counts.sub + counts.dec;
  const denom = n + SHRINKAGE_K;
  return {
    dec: (counts.dec + SHRINKAGE_K * prior.dec) / denom,
    ko: (counts.ko + SHRINKAGE_K * prior.ko) / denom,
    sub: (counts.sub + SHRINKAGE_K * prior.sub) / denom,
  };
}

function priorSplit(bucket: WeightBucket): ThreeWaySplit {
  const koShare = KO_SHARE[bucket];
  return { dec: BASE.DECISION, ko: (1 - BASE.DECISION) * koShare, sub: (1 - BASE.DECISION) * (1 - koShare) };
}

/**
 * The intern's third judgment, alongside decideInternPick and
 * decideInternBet -- how the fight ends, not who wins it.
 *
 * Pure and deterministic, same as the other two, so the eventual
 * method-scoring pass (docs/PRD.md Could-have) can grade a rule rather
 * than a mood.
 *
 * **Fallback (picked or opponent is null -- no Sherdog data on one or
 * both sides):** base rates plus the two signals available for every
 * fight -- lopsidedness (decides finish vs decision) and weight class
 * (decides KO vs submission within the finish pool). This is the
 * original rule, unchanged, and this path can never produce FINISH.
 *
 * **Real signal (L5, both sides present):** the picked fighter's own win
 * split and the opponent's own loss split, each shrunk toward the
 * weight-class prior for a small sample (`shrinkToward`), combined with a
 * **geometric mean** on the finish-vs-decision axis, not an average --
 * going the distance needs only ONE side to resist a finish (an opponent
 * who has never been finished drags the fight toward decision even
 * against a heavy finisher), so a low share on either side pulls the
 * combined number down harder than an average would. That combined
 * number becomes a **capped nudge** (`MAX_RECORD_FINISH_SHIFT`) on top of
 * the exact same finish pool the fallback rule already computes, and the
 * KO-vs-submission share is **blended** with the weight-class prior
 * rather than fully replacing it -- both caps exist because an earlier,
 * uncapped version of this function over-called finishes badly (see
 * `MAX_RECORD_FINISH_SHIFT`'s comment and DECISIONS.md). Candidates are
 * still compared to DECISION individually, same as the fallback rule,
 * not as a combined finish-pool-vs-decision test -- that structural
 * match is what keeps this exactly as conservative as the original rule
 * about calling a finish at all.
 *
 * When a finish wins, the KO share **within** it decides the final call:
 * a share past `KO_VS_SUB_THRESHOLD` names KO_TKO or SUBMISSION
 * outright; a genuinely mixed share (a fighter who finishes both ways
 * about equally, or two mismatched signals) returns FINISH -- "ends
 * early, unclear how" -- rather than guessing a side.
 *
 * Every one of the four methods is reachable with real data present; only
 * DECISION/KO_TKO/SUBMISSION are reachable on the fallback path (tests
 * brute-force both grids to keep it that way).
 *
 * The `estimatedProbability` passed in is the predicted (winning)
 * fighter's, always >= 0.5, but the `abs` guards a caller that passes
 * the raw number.
 */
export function predictInternMethod(
  estimatedProbability: number,
  weightClass: string | null,
  picked: FinishSplit | null = null,
  opponent: FinishSplit | null = null,
): InternMethodDecision {
  const lopsidedness = Math.min(1, Math.abs(estimatedProbability - 0.5) * 2);
  const bucket = weightBucket(weightClass);

  if (picked !== null && opponent !== null) {
    return predictFromRecords(lopsidedness, bucket, picked, opponent);
  }
  return predictFromWeightClassOnly(lopsidedness, bucket);
}

function predictFromWeightClassOnly(lopsidedness: number, bucket: WeightBucket): InternMethodDecision {
  const finishPool = BASE.KO_TKO + BASE.SUBMISSION + lopsidedness * MAX_FINISH_SHIFT;
  const koShare = KO_SHARE[bucket];

  const scores: Record<Exclude<FightMethod, "FINISH">, number> = {
    DECISION: BASE.DECISION - lopsidedness * MAX_FINISH_SHIFT,
    KO_TKO: finishPool * koShare,
    SUBMISSION: finishPool * (1 - koShare),
  };

  const order: Array<Exclude<FightMethod, "FINISH">> = ["DECISION", "KO_TKO", "SUBMISSION"];
  const method = order.reduce((best, m) => (scores[m] > scores[best] ? m : best), order[0]);

  return { method, note: describeWeightClassOnly(method, lopsidedness, bucket) };
}

function predictFromRecords(
  lopsidedness: number,
  bucket: WeightBucket,
  picked: FinishSplit,
  opponent: FinishSplit,
): InternMethodDecision {
  const prior = priorSplit(bucket);
  const pickedSplit = shrinkToward({ ko: picked.winsKo, sub: picked.winsSub, dec: picked.winsDec }, prior);
  const opponentSplit = shrinkToward(
    { ko: opponent.lossesKo, sub: opponent.lossesSub, dec: opponent.lossesDec },
    prior,
  );

  const pickedFinishFrac = pickedSplit.ko + pickedSplit.sub;
  const opponentFinishFrac = opponentSplit.ko + opponentSplit.sub;

  // Geometric mean, not an average: going the distance only needs ONE
  // side to resist a finish (an opponent who has never been finished
  // drags the fight toward decision even against a heavy finisher), so a
  // low share on either side should pull the combined number down harder
  // than an average would.
  const combinedFinishFrac = Math.sqrt(pickedFinishFrac * opponentFinishFrac);
  const recordFinishShift = clamp(
    combinedFinishFrac - 0.5,
    -MAX_RECORD_FINISH_SHIFT,
    MAX_RECORD_FINISH_SHIFT,
  );

  const pickedKoShare = pickedFinishFrac > 0 ? pickedSplit.ko / pickedFinishFrac : KO_SHARE[bucket];
  const opponentKoShare = opponentFinishFrac > 0 ? opponentSplit.ko / opponentFinishFrac : KO_SHARE[bucket];
  // Blended, not fully record-driven -- the weight-class prior still gets
  // a vote, same "don't let one signal overwhelm the base rate" rule the
  // rest of the intern's signals follow (decideInternPick.ts's
  // MAX_TOTAL_ADJUSTMENT). WEIGHT_CLASS_VOTE is capped at 0.4118 (not a
  // round number picked for looks) -- a straight 50/50 blend was found,
  // by a reviewer pass, to make SUBMISSION mathematically UNREACHABLE in
  // the heavy bucket: KO_SHARE.heavy = 0.85, so even a pure submission
  // record on both sides (avgRecordKoShare = 0) only pulls the blend down
  // to 0.425, above the 0.35 cutoff. This is exactly the class of dead-
  // branch bug RETROSPECTIVE.md already flagged once (Phase 62) -- a
  // reachability test now brute-forces every bucket to keep it caught.
  // 0.35 leaves margin under the 0.4118 ceiling in every bucket (see that
  // test for the per-bucket algebra).
  const WEIGHT_CLASS_VOTE = 0.35;
  const koShareOfFinish =
    WEIGHT_CLASS_VOTE * KO_SHARE[bucket] + (1 - WEIGHT_CLASS_VOTE) * ((pickedKoShare + opponentKoShare) / 2);

  // Same finish pool as the fallback rule, plus the capped record nudge --
  // and the same "each candidate compared to DECISION on its own" test,
  // not the pool as a whole, so this stays exactly as conservative about
  // calling a finish as the original rule was (see MAX_RECORD_FINISH_SHIFT
  // above for why that structural match matters).
  const finishPool = clamp(
    BASE.KO_TKO + BASE.SUBMISSION + lopsidedness * MAX_FINISH_SHIFT + recordFinishShift,
    0,
    1,
  );
  const scores = {
    DECISION: 1 - finishPool,
    KO_TKO: finishPool * koShareOfFinish,
    SUBMISSION: finishPool * (1 - koShareOfFinish),
  };

  if (scores.DECISION >= scores.KO_TKO && scores.DECISION >= scores.SUBMISSION) {
    return { method: "DECISION", note: describeRecords("DECISION", picked, opponent) };
  }

  const method: FightMethod =
    koShareOfFinish >= KO_VS_SUB_THRESHOLD
      ? "KO_TKO"
      : koShareOfFinish <= 1 - KO_VS_SUB_THRESHOLD
        ? "SUBMISSION"
        : "FINISH";

  return { method, note: describeRecords(method, picked, opponent) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function describeWeightClassOnly(method: FightMethod, lopsidedness: number, bucket: WeightBucket): string {
  const bucketPhrase =
    bucket === "heavy" ? "heavier division" : bucket === "light" ? "lighter division" : null;
  const lopsidedPhrase =
    lopsidedness >= 0.6 ? "lopsided matchup" : lopsidedness <= 0.2 ? "close matchup" : null;
  const reasons = [lopsidedPhrase, bucketPhrase].filter(Boolean).join(", ");
  return reasons ? `Method: ${methodLabel(method)} (${reasons}).` : `Method: ${methodLabel(method)}.`;
}

function describeRecords(method: FightMethod, picked: FinishSplit, opponent: FinishSplit): string {
  const pickedFinishes = picked.winsKo + picked.winsSub;
  const pickedWins = pickedFinishes + picked.winsDec;
  const opponentFinishLosses = opponent.lossesKo + opponent.lossesSub;
  const opponentLosses = opponentFinishLosses + opponent.lossesDec;
  const reason = `${pickedFinishes} of ${pickedWins} wins by finish, opponent finished in ${opponentFinishLosses} of ${opponentLosses} losses`;
  return `Method: ${methodLabel(method)} (${reason}).`;
}

function methodLabel(method: FightMethod): string {
  switch (method) {
    case "KO_TKO":
      return "KO/TKO";
    case "SUBMISSION":
      return "submission";
    case "FINISH":
      return "finish (unclear how)";
    default:
      return "decision";
  }
}
