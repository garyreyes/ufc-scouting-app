import { INTERN_LOCK_OFFSET_HOURS, isPickLocked } from "@/lib/picks/pickLockOffsets";
import styles from "./InternLockStatus.module.css";

// Reviewer caught (2026-09-12): this must format time until the INTERN's
// actual lock instant (startsAt minus its own offset), not until the card
// start itself -- the original version passed raw startsAt straight
// through and overstated the remaining window by exactly
// INTERN_LOCK_OFFSET_HOURS every time.
function formatTimeUntil(lockAtMs: number, now: Date): string {
  const hours = Math.floor((lockAtMs - now.getTime()) / 3_600_000);
  if (hours < 1) return "less than an hour";
  if (hours === 1) return "1 hour";
  return `${hours} hours`;
}

/**
 * L4: the intern locks earlier than the owner (6h vs 1h before start --
 * src/lib/picks/pickLockOffsets.ts), so the owner has no way to tell from
 * the rest of the page whether the intern can still revise its pick on
 * this card. One quiet line, same caption pattern as RumourHealthNotice,
 * owner-gated at the call site in events/[id]/page.tsx (the intern's own
 * lock timing isn't meaningful to a non-owner viewer, who never sees pick
 * controls at all).
 */
export function InternLockStatus({ startsAt }: { startsAt: string | null }) {
  if (startsAt === null) return null;

  const now = new Date();
  const locked = isPickLocked(startsAt, "INTERN", now);
  const lockAtMs = new Date(startsAt).getTime() - INTERN_LOCK_OFFSET_HOURS * 60 * 60 * 1000;

  return (
    <p className={styles.caption}>
      {locked ? "Intern picks: locked." : `Intern picks lock in ${formatTimeUntil(lockAtMs, now)}.`}
    </p>
  );
}
