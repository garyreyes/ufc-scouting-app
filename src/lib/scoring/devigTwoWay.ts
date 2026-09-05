import { impliedProbability } from "./impliedProbability";

/**
 * The market's actual opinion on a two-fighter bout, with the
 * bookmaker's margin removed.
 *
 * Raw `1/price` for both sides sums to more than 1 -- that overround is
 * the book's markup, not its read -- so using it directly hands anyone
 * downstream phantom edge on essentially every fight. Rescaling each
 * side by the pair's total keeps their ratio and makes the numbers a
 * real probability pair.
 *
 * Extracted from decideInternPick.ts, which computed this inline and
 * only kept the result as a display string. The intern's pick anchor and
 * the card-read panel's "market %" column must be the same number, so
 * this is one definition -- same reason `edge`, `impliedProbability`,
 * and `probabilityForFighter` are each their own file.
 */
export function devigTwoWay(
  price1: number,
  price2: number,
): { prob1: number; prob2: number } {
  const raw1 = impliedProbability(price1);
  const raw2 = impliedProbability(price2);
  const total = raw1 + raw2;
  return { prob1: raw1 / total, prob2: raw2 / total };
}
