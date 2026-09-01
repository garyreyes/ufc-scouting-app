import type { JobRunRow } from "./types";

// How stale a tracked job's latest successful run can be before the
// banner treats it as broken rather than merely between runs. 3x the
// odds.yml cron cadence (2h) -- one missed tick is normal jitter (a slow
// GitHub Actions runner, a transient API error the retry didn't cover
// yet), two in a row is a real signal.
export const STALE_THRESHOLD_HOURS = 6;

export type JobHealthStatus = { kind: "healthy" } | { kind: "degraded"; reasons: string[] };

/**
 * The actual "loud, never silent" decision (docs/user-flows.md, PROJECT_
 * FACTS.md): true when either (a) a tracked job's own execution looks
 * broken -- never run, its latest run failed, or its latest success is
 * older than STALE_THRESHOLD_HOURS -- or (b) missedSnapshotCount is above
 * zero. (b) exists because (a) alone can't see the real highest-impact
 * failure: a job that keeps succeeding every run while one specific
 * fight's odds event simply never appears in the feed (decideMatch's
 * no_candidates case) sits unpriced past T-12h forever, with no execution
 * failure to show for it.
 */
export function evaluateJobHealth(
  runs: JobRunRow[],
  trackedJobNames: readonly string[],
  missedSnapshotCount: number,
  now: Date,
): JobHealthStatus {
  const reasons: string[] = [];

  for (const jobName of trackedJobNames) {
    const latest = runs.find((r) => r.jobName === jobName);

    if (!latest) {
      reasons.push(`${jobName} has never run yet`);
      continue;
    }

    if (latest.status === "failure") {
      reasons.push(`${jobName} failed${latest.error ? `: ${latest.error}` : ""}`);
      continue;
    }

    const ageHours = (now.getTime() - new Date(latest.finishedAt).getTime()) / 3_600_000;
    if (ageHours > STALE_THRESHOLD_HOURS) {
      reasons.push(`${jobName} hasn't run successfully in ${Math.floor(ageHours)}h`);
    }
  }

  if (missedSnapshotCount > 0) {
    reasons.push(
      `${missedSnapshotCount} fight${missedSnapshotCount === 1 ? "" : "s"} past the T-12h window still unpriced`,
    );
  }

  return reasons.length > 0 ? { kind: "degraded", reasons } : { kind: "healthy" };
}
