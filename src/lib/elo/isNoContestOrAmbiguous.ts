/**
 * Whether a null-winner fight's method makes it a No Contest, or leaves
 * it too ambiguous to interpret at all.
 *
 * A No Contest is not a real competitive result -- officially, it is as
 * if the fight never happened -- so it must never move a rating the way
 * a real draw does, and must never appear in a fighter's record.
 * Wikipedia's own method text is the only signal that distinguishes the
 * two (evaluateFightSettlement.ts's own test fixture: `method: "NC
 * (overturned)"`), and when method itself is null (the
 * api_sports_only_24h settlement path writes it that way,
 * evaluateFightSettlement.ts's own last branch), there is no way to tell
 * a draw from an NC at all -- excluded rather than guessed, the same
 * "ambiguous -> drop, don't guess" rule this project already applies to
 * rumour-flag fighter attribution.
 *
 * **Extracted from computeEloHistory.ts in I5, when records became its
 * second caller.** Both a fighter's Elo and a fighter's W-L-D have to
 * agree about what a given fight was; two independently-written copies
 * of this regex would eventually disagree about the same row, and the
 * disagreement would be silent -- a fighter showing a draw on their
 * record for a fight Elo had already discarded as an NC. Same
 * extract-on-second-caller move as processScheduleEvent.ts.
 */
export function isNoContestOrAmbiguous(method: string | null): boolean {
  if (method === null) return true;
  return /\bNC\b|no contest/i.test(method);
}
