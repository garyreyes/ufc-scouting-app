/**
 * A fighter's derived W-L-D as one display string.
 *
 * Shared because both the fighter profile (features/fighters) and the
 * fight page's tale-of-the-tape (features/fights) show the same number,
 * and CLAUDE.md's boundary rule sends anything two features need into
 * shared/ rather than one reaching across into the other.
 *
 * **A total of zero is not a record.** lib/records/deriveFighterRecords.ts
 * deliberately omits a fighter with no countable outcome from its map
 * rather than asserting three zeroes, and recomputeFighterRecords.ts
 * stores that as 0-0-0. Rendering it literally would read as "fought and
 * never won," when what it actually means is "this app tracks no
 * completed fights for them" -- a real and common state for a
 * Wikipedia-only fighter on an upcoming card.
 *
 * Draws are omitted when there are none, matching how records are
 * written everywhere outside this app.
 */
export function formatRecord(record: { wins: number; losses: number; draws: number }): string {
  const { wins, losses, draws } = record;
  if (wins + losses + draws === 0) return "No tracked fights";
  return draws > 0 ? `${wins}-${losses}-${draws}` : `${wins}-${losses}`;
}
