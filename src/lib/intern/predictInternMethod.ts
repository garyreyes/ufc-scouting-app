import type { FightMethod } from "../scoring/fightMethod";

export interface InternMethodDecision {
  method: FightMethod;
  note: string;
}

// Rough UFC base rates across all divisions -- the honest starting point,
// since nothing in this app measures a fighter's own finish rate (no
// such data source exists). A stated assumption, and the first numbers
// to revisit if method predictions turn out badly calibrated.
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
// lighter divisions scramble and submit. These are the only knobs that
// decide KO vs submission, so both branches are always reachable: a
// lopsided light-division fight predicts submission, a lopsided
// heavy-division fight predicts KO, and everything in between leans KO.
const KO_SHARE: Record<WeightBucket, number> = { heavy: 0.85, mid: 0.62, light: 0.4 };

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

/**
 * The intern's third judgment, alongside decideInternPick and
 * decideInternBet -- how the fight ends, not who wins it.
 *
 * Pure and deterministic, same as the other two, so the eventual
 * method-scoring pass (docs/PRD.md Could-have) can grade a rule rather
 * than a mood. There is no finish-rate data anywhere in this app, so
 * this is base rates plus the two signals it does have:
 *
 *  - **Lopsidedness** decides finish vs decision. `|prob - 0.5|` pulls
 *    mass out of "decision" and into the finish pool -- a mismatch ends
 *    early, a close fight goes the distance. This is the master dial.
 *  - **Weight class** decides KO vs submission *within* that finish
 *    pool. Heavier -> KO, lighter -> submission.
 *
 * argmax of the adjusted three, ties breaking decision > KO > submission
 * (base-rate order). Every method is reachable -- a close fight at any
 * weight is a decision, a lopsided heavyweight fight is a KO, a lopsided
 * flyweight fight is a submission (a regression test brute-forces the
 * input grid to keep it that way).
 *
 * The `estimatedProbability` passed in is the predicted (winning)
 * fighter's, always >= 0.5, but the `abs` guards a caller that passes
 * the raw number.
 */
export function predictInternMethod(
  estimatedProbability: number,
  weightClass: string | null,
): InternMethodDecision {
  const lopsidedness = Math.min(1, Math.abs(estimatedProbability - 0.5) * 2);
  const bucket = weightBucket(weightClass);

  const finishPool = BASE.KO_TKO + BASE.SUBMISSION + lopsidedness * MAX_FINISH_SHIFT;
  const koShare = KO_SHARE[bucket];

  const scores: Record<FightMethod, number> = {
    DECISION: BASE.DECISION - lopsidedness * MAX_FINISH_SHIFT,
    KO_TKO: finishPool * koShare,
    SUBMISSION: finishPool * (1 - koShare),
  };

  const order: FightMethod[] = ["DECISION", "KO_TKO", "SUBMISSION"];
  const method = order.reduce((best, m) => (scores[m] > scores[best] ? m : best), order[0]);

  const bucketPhrase =
    bucket === "heavy" ? "heavier division" : bucket === "light" ? "lighter division" : null;
  const lopsidedPhrase =
    lopsidedness >= 0.6 ? "lopsided matchup" : lopsidedness <= 0.2 ? "close matchup" : null;
  const reasons = [lopsidedPhrase, bucketPhrase].filter(Boolean).join(", ");

  const label = method === "KO_TKO" ? "KO/TKO" : method === "SUBMISSION" ? "submission" : "decision";
  const note = reasons ? `Method: ${label} (${reasons}).` : `Method: ${label}.`;

  return { method, note };
}
