import { applyProbabilityDelta } from "../scoring/applyProbabilityDelta";
import { impliedProbability } from "../scoring/impliedProbability";
import { eloAdjustment } from "../elo/eloAdjustment";
import { flagPenalty } from "./flagPenalty";
import type { InternPickDecision, InternPickInput } from "./types";

/**
 * Confidence (1-5) derived from the final probability's distance from a
 * coin flip. 0019_picks.sql calls this "a coarse gut-check distinct from
 * estimated_probability's precise number" -- for the intern that means a
 * plain deterministic banding of the number it already produced, not a
 * second independent judgment it doesn't have.
 *
 * Capped when either fighter has a thin rated-fight sample: a debutant
 * matchup should never read as confidently as a fight between two
 * proven veterans at the same raw probability, since the intern's
 * Elo-based read of a debutant is close to a guess, not a real
 * assessment (user-confirmed 2026-09-02, discussing this exact gap).
 */
function confidenceFor(probability: number, minRatedFightCount: number): number {
  let base: number;
  if (probability < 0.55) base = 1;
  else if (probability < 0.62) base = 2;
  else if (probability < 0.72) base = 3;
  else if (probability < 0.85) base = 4;
  else base = 5;

  if (minRatedFightCount < 3) return Math.min(base, 2);
  if (minRatedFightCount < 6) return Math.min(base, 3);
  return base;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * The intern's whole opinion, as a pure function (docs/PRD.md UC-3:
 * "anchors on the market and deviates when its own scouting gives it a
 * reason to"). Deterministic by design, user-confirmed 2026-09-02 over an
 * LLM call: the same fight always produces the same number, which is what
 * makes G3's calibration check interpretable at all -- with a
 * non-deterministic estimator you cannot tell a bad rule from a bad day.
 *
 * Correctness-critical (ARCHITECTURE.md item #2): this probability is
 * what G2's edge gate will multiply by the price to decide whether the
 * intern bets at all, so an error here doesn't produce a wrong number, it
 * produces a silently wrong strategy.
 *
 * **The market anchor is de-vigged.** Raw 1/price for both fighters sums
 * to more than 1 (that overround is the bookmaker's margin), so using it
 * directly would hand the intern phantom edge on essentially every fight.
 * Normalising each side by the pair's total is what makes the anchor the
 * market's actual opinion rather than its opinion plus its markup.
 */
export function decideInternPick(input: InternPickInput): InternPickDecision {
  const { fighter1, fighter2, odds, flags } = input;

  const marketAnchored = odds !== null;
  let anchor1: number;
  let anchorNote: string;

  if (odds !== null) {
    const raw1 = impliedProbability(odds.fighter1Price);
    const raw2 = impliedProbability(odds.fighter2Price);
    anchor1 = raw1 / (raw1 + raw2);
    anchorNote =
      `Market anchor ${pct(anchor1)} ${fighter1.name} ` +
      `(de-vigged from ${odds.fighter1Price} / ${odds.fighter2Price}).`;
  } else {
    anchor1 = 0.5;
    anchorNote = "No market price yet — anchored at an even 50%.";
  }

  const flags1 = flags.filter((f) => f.fighterId === fighter1.id);
  const flags2 = flags.filter((f) => f.fighterId === fighter2.id);
  const penalty1 = flagPenalty(flags1);
  const penalty2 = flagPenalty(flags2);

  // A concern on your opponent helps you by exactly as much as it hurts
  // them -- one shared shift, applied once, so the two sides always stay
  // complementary. Elo is the same shape: one more bounded, signed shift
  // toward whichever fighter rates higher, added alongside the rumour
  // delta rather than blended/averaged with the market anchor -- see
  // lib/elo/eloAdjustment.ts for why.
  const eloDelta = eloAdjustment(fighter1.eloRating, fighter2.eloRating);
  const delta = penalty2 - penalty1 + eloDelta;
  const probability1 = applyProbabilityDelta(anchor1, delta);

  // Ties break toward fighter1, the same deterministic convention
  // lib/scoring/determineFavorite.ts already uses for the chalk line.
  const predictsFighter1 = probability1 >= 0.5;
  const predicted = predictsFighter1 ? fighter1 : fighter2;
  const estimatedProbability = predictsFighter1 ? probability1 : 1 - probability1;

  const rumourNote =
    penalty1 === 0 && penalty2 === 0
      ? "No rumour flags on either fighter."
      : `Rumour adjustment: −${pct(penalty1)} ${fighter1.name} ` +
        `(${flags1.length} flag${flags1.length === 1 ? "" : "s"}), ` +
        `−${pct(penalty2)} ${fighter2.name} ` +
        `(${flags2.length} flag${flags2.length === 1 ? "" : "s"}).`;

  const eloNote = `Elo: ${fighter1.name} ${Math.round(fighter1.eloRating)} (${fighter1.ratedFightCount} rated), ${fighter2.name} ${Math.round(fighter2.eloRating)} (${fighter2.ratedFightCount} rated).`;

  const minRatedFightCount = Math.min(fighter1.ratedFightCount, fighter2.ratedFightCount);

  return {
    predictedFighterId: predicted.id,
    estimatedProbability,
    confidence: confidenceFor(estimatedProbability, minRatedFightCount),
    reasoning: `${anchorNote} ${rumourNote} ${eloNote} Final: ${pct(estimatedProbability)} ${predicted.name}.`,
    marketAnchored,
  };
}
