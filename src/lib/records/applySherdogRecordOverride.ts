import type { FighterRecord } from "./deriveFighterRecords";

const ZERO: FighterRecord = { wins: 0, losses: 0, draws: 0 };

/**
 * J5: for a Sherdog-linked fighter, their real career record from
 * `fighter_sherdog_bouts` replaces the app-graph count (which is only
 * "2022 onward, thinner before 2025"). Everyone else keeps the graph
 * count.
 *
 * A linked fighter is authoritative from Sherdog even when Sherdog has
 * no bouts for them -- that means Sherdog records them as fightless, and
 * a partial graph count would be the wrong number to show. J4's
 * cross-check (buildSherdogBoutRows) already guarantees a linked
 * fighter's Sherdog page reconciled against its own headline, so this
 * override is trusting a number that was verified at import time.
 *
 * Returns a new map; inputs are not mutated.
 */
export function applySherdogRecordOverride(
  graphRecords: Map<string, FighterRecord>,
  sherdogRecords: Map<string, FighterRecord>,
  sherdogLinkedFighterIds: Iterable<string>,
): Map<string, FighterRecord> {
  const out = new Map(graphRecords);
  for (const fighterId of sherdogLinkedFighterIds) {
    out.set(fighterId, sherdogRecords.get(fighterId) ?? ZERO);
  }
  return out;
}
