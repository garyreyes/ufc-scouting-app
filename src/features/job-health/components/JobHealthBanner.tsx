import { getLatestJobRuns, getMissedSnapshotCount, TRACKED_JOB_NAMES } from "../api";
import { evaluateJobHealth } from "../evaluateJobHealth";
import { RetryButton } from "./RetryButton";
import styles from "./JobHealthBanner.module.css";

/**
 * All the fetching this component needs, kept separate from JSX
 * construction below -- react-hooks/error-boundaries flags try/catch
 * wrapped around JSX because React doesn't render synchronously, so a
 * catch there wouldn't actually catch a rendering error. Returning null
 * covers both "healthy" and "couldn't tell" -- a banner that can't check
 * job health must never be the reason the rest of the app shell goes
 * down with it.
 *
 * Deliberately does NOT check who's viewing here -- see actions.ts's
 * checkCanRetryAction docstring for why that check lives in a client-
 * triggered action instead of this server render.
 */
async function getBannerReasons(): Promise<string[] | null> {
  try {
    const [runs, missedSnapshotCount] = await Promise.all([
      getLatestJobRuns(),
      getMissedSnapshotCount(),
    ]);
    const status = evaluateJobHealth(runs, TRACKED_JOB_NAMES, missedSnapshotCount, new Date());
    return status.kind === "healthy" ? null : status.reasons;
  } catch {
    return null;
  }
}

/**
 * App-shell chrome (docs/user-flows.md: "Job health is a banner in the
 * app shell, not a screen"), composed into layout.tsx and passed into
 * AppShell as a prop -- see AppShell.tsx's `banner` prop comment for why
 * that indirection exists. Renders nothing when healthy: this must never
 * be the loud thing on a healthy day, only a degraded one.
 */
export async function JobHealthBanner() {
  const reasons = await getBannerReasons();
  if (!reasons) return null;

  return (
    <div className={styles.banner} role="status">
      <div className={styles.reasons}>
        <strong>Odds job degraded</strong>
        <ul>
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>
      <RetryButton />
    </div>
  );
}
