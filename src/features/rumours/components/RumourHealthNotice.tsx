import { getRumourScanHealth } from "../api";
import styles from "./RumourHealthNotice.module.css";

function formatAge(iso: string, now: Date): string {
  const hours = Math.floor((now.getTime() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return "less than an hour ago";
  if (hours === 1) return "1 hour ago";
  if (hours < 48) return `${hours} hours ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

/**
 * docs/user-flows.md's `/events/[id]` states table:
 * - "Rumour engine degraded" -> "Flags unavailable, last scraped X" --
 *   never a silent zero, which is indistinguishable from "nothing to
 *   report."
 * - "Bluesky stale" -> flags ARE shown, just stamped with their age.
 *
 * One component covers both: healthy renders a quiet caption (this is
 * the "stamped with their age" half), degraded swaps to a louder notice
 * using the same neutral-surface-plus-accent-heading pattern
 * JobHealthBanner already established, not a second colour. Failing to
 * even determine health (a query error) renders nothing rather than a
 * broken page -- same "must never be the reason the rest of the app goes
 * down" rule JobHealthBanner's own getBannerReasons follows.
 */
export async function RumourHealthNotice() {
  let health: Awaited<ReturnType<typeof getRumourScanHealth>>;
  try {
    health = await getRumourScanHealth();
  } catch {
    return null;
  }

  if (health.lastScrapedAt === null) {
    // The job has genuinely never run -- distinct from "ran, but stale,"
    // since there's no age to report.
    return (
      <p className={styles.degraded} role="status">
        Flags unavailable — the rumour scan hasn&apos;t run yet.
      </p>
    );
  }

  const age = formatAge(health.lastScrapedAt, new Date());

  if (health.degraded) {
    return (
      <p className={styles.degraded} role="status">
        Flags unavailable, last scraped {age}.
      </p>
    );
  }

  return <p className={styles.caption}>Rumours last scraped {age}.</p>;
}
