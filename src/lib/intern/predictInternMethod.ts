import type { FightMethod } from "../scoring/fightMethod";

export interface InternMethodDecision {
  method: FightMethod;
  note: string;
}

// Rough UFC base rates across all divisions -- the honest starting point,
// since nothing in this app measures a fighter's own finish rate (no
// such data source exists). These are a stated assumption, and the first
// numbers to revisit if method predictions turn out badly calibrated.
const BASE = { DECISION: 0.5, KO_TKO: 0.33, SUBMISSION: 0.17 };

// The most a lopsided matchup can pull out of "decision" and into the
// two finish methods (split by their base ratio). A near-total mismatch
// gets close to this; a coin flip gets none of it.
const MAX_FINISH_SHIFT = 0.25;

// How far the weight class tilts KO/TKO against the other two.
const WEIGHT_TILT = 0.12;

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
 * this is base rates plus two signals it *does* have:
 *
 *  - **Lopsidedness.** A mismatch ends early. `|prob - 0.5|` shifts mass
 *    from decision into the finish methods, split by their base ratio.
 *  - **Weight class.** Heavier divisions KO; lighter divisions go the
 *    distance and submit more. Tilts KO/TKO against the other two.
 *
 * argmax of the adjusted three, ties breaking decision > KO > submission
 * (base-rate order). The `estimatedProbability` passed in is the
 * predicted (winning) fighter's, always >= 0.5, but the `abs` guards a
 * caller that passes the raw number.
 */
export function predictInternMethod(
  estimatedProbability: number,
  weightClass: string | null,
): InternMethodDecision {
  const lopsidedness = Math.min(1, Math.abs(estimatedProbability - 0.5) * 2);

  const scores: Record<FightMethod, number> = { ...BASE };

  const finishShift = lopsidedness * MAX_FINISH_SHIFT;
  scores.DECISION -= finishShift;
  scores.KO_TKO += finishShift * (BASE.KO_TKO / BASE.DECISION);
  scores.SUBMISSION += finishShift * (BASE.SUBMISSION / BASE.DECISION);

  const bucket = weightBucket(weightClass);
  if (bucket === "heavy") {
    scores.KO_TKO += WEIGHT_TILT;
    scores.DECISION -= WEIGHT_TILT * 0.66;
    scores.SUBMISSION -= WEIGHT_TILT * 0.34;
  } else if (bucket === "light") {
    scores.KO_TKO -= WEIGHT_TILT;
    scores.DECISION += WEIGHT_TILT * 0.6;
    scores.SUBMISSION += WEIGHT_TILT * 0.4;
  }

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
