// How far before a card's confirmed start the one T-12h snapshot is allowed
// to fire (docs/PRD.md #9: "one scheduled odds snapshot taken ~12 hours
// before the card"). This is the gate `matchAndSnapshot` did NOT have when
// it was built in B3 -- it wrote against every unpriced fight regardless of
// how far away the card was. Left ungated, the first live run after B4
// discovers a card's starts_at would freeze a price weeks early, against
// odds_snapshots' own immutability trigger (0013_odds_snapshots.sql):
// wrong-too-early is just as permanent as wrong-too-late.
export const SNAPSHOT_LEAD_HOURS = 12;

/**
 * True once the card is confidently known to be within SNAPSHOT_LEAD_HOURS
 * of starting, or has already started. False -- never eligible -- when
 * `startsAt` is null, i.e. B4 hasn't found a confident match yet; there is
 * no clock to measure against, so this must not default to "eligible."
 */
export function isPastSnapshotWindow(startsAt: string | null, now: Date): boolean {
  if (!startsAt) return false;
  const windowOpensAt = new Date(startsAt).getTime() - SNAPSHOT_LEAD_HOURS * 60 * 60 * 1000;
  return now.getTime() >= windowOpensAt;
}
