// How far before a card's confirmed start each author's picks lock --
// Phase L4. Owner direction (2026-09-10): the intern locks earlier than the
// owner so it can still react to a late rumour (e.g. a Friday pick flipping
// after bad news breaks) but is settled well ahead of the card, while the
// owner's own picks stay open almost to the last minute.
//
// T-6h for INTERN, not T-12h as first requested -- T-12h is the exact
// instant the odds_snapshots trigger's write-once price window opens
// (SNAPSHOT_LEAD_HOURS, lib/odds/snapshotWindow.ts), so a lock exactly
// there would mean the intern's last allowed write always happens strictly
// before the market ever prices the fight, permanently defeating the
// market-anchor design (ARCHITECTURE.md Fork 10). T-6h leaves ~3 of the
// intern cron's scheduled runs (every 2h, `30 */2 * * *`) to react to the
// real T-12h price before its own window closes.
//
// These two constants are mirrored by hand in
// supabase/migrations/0041_author_aware_pick_lock.sql -- a Postgres trigger
// can't import a TS module, so if either number ever changes here, that
// migration's own copy must change with it, plus a new migration (never
// edit an applied one).
export const INTERN_LOCK_OFFSET_HOURS = 6;
export const USER_LOCK_OFFSET_HOURS = 1;

export type PickAuthor = "USER" | "INTERN";

/**
 * True once `author`'s pick window for this card has closed -- their own
 * offset before `startsAt`, or the card has already started. False when
 * `startsAt` is null, same rule check_pick_constraints() already applies:
 * an unconfirmed card has no clock to measure against, so it must not
 * default to "locked."
 */
export function isPickLocked(startsAt: string | null, author: PickAuthor, now: Date): boolean {
  if (!startsAt) return false;
  const offsetHours = author === "INTERN" ? INTERN_LOCK_OFFSET_HOURS : USER_LOCK_OFFSET_HOURS;
  const locksAt = new Date(startsAt).getTime() - offsetHours * 60 * 60 * 1000;
  return now.getTime() >= locksAt;
}
