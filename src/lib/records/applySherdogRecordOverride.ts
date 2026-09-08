import type { FighterRecord } from "./deriveFighterRecords";

/**
 * J5: for a Sherdog-linked fighter, their real career record from
 * `fighter_sherdog_bouts` replaces the app-graph count (which is only
 * "2022 onward, thinner before 2025"). Everyone else keeps the graph
 * count.
 *
 * The override only applies when Sherdog actually has a countable record
 * for the fighter (`sherdogRecords.has(id)`). A linked fighter with zero
 * countable Sherdog bouts -- a freshly-signed fighter whose Sherdog page
 * is still an empty `0-0` stub -- keeps the graph count instead: Sherdog
 * being behind is not a reason to wipe a record the app has already
 * settled, and it avoids a page that says "no tracked fights" next to a
 * fight in the history list. J4's cross-check (buildSherdogBoutRows)
 * already guarantees a non-empty Sherdog record reconciled against its
 * own headline at import time.
 *
 * Returns a new map; inputs are not mutated.
 */
export function applySherdogRecordOverride(
  graphRecords: Map<string, FighterRecord>,
  sherdogRecords: Map<string, FighterRecord>,
  sherdogLinkedFighterIds: Iterable<string>,
): Map<string, FighterRecord> {
  const linked = new Set(sherdogLinkedFighterIds);
  const out = new Map(graphRecords);
  for (const fighterId of linked) {
    const sherdogRecord = sherdogRecords.get(fighterId);
    if (sherdogRecord) out.set(fighterId, sherdogRecord);
  }
  return out;
}
