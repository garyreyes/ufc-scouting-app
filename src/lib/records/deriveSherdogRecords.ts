import type { FighterRecord } from "./deriveFighterRecords";

// One row from fighter_sherdog_bouts as the record count reads it.
export interface SherdogBoutForRecord {
  fighterId: string;
  result: "win" | "loss" | "draw" | "nc" | "unknown";
}

/**
 * Counts W-L-D per fighter from their imported Sherdog bouts (J5).
 *
 * The Sherdog equivalent of deriveFighterRecords.ts, and it follows the
 * same two conventions:
 *  - a No Contest counts as nothing (there is no NC column on `fighters`,
 *    same as the graph derivation), and neither does an `unknown` result
 *    -- though J4's buildSherdogBoutRows already rejects a page with any
 *    `unknown` row, so that branch is defensive;
 *  - a fighter with no countable bout is ABSENT from the map, not present
 *    at 0-0-0, so the caller can tell "counted, nothing" from "not
 *    imported."
 *
 * Pure and I/O-free; recomputeFighterRecords.ts owns the read and the
 * override.
 */
export function deriveSherdogRecords(bouts: SherdogBoutForRecord[]): Map<string, FighterRecord> {
  const records = new Map<string, FighterRecord>();

  const entryFor = (fighterId: string): FighterRecord => {
    const existing = records.get(fighterId);
    if (existing) return existing;
    const fresh = { wins: 0, losses: 0, draws: 0 };
    records.set(fighterId, fresh);
    return fresh;
  };

  for (const { fighterId, result } of bouts) {
    if (result === "win") entryFor(fighterId).wins++;
    else if (result === "loss") entryFor(fighterId).losses++;
    else if (result === "draw") entryFor(fighterId).draws++;
    // 'nc' and 'unknown' count as nothing
  }

  return records;
}
