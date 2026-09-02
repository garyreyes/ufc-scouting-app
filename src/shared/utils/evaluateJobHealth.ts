// Moved here from features/job-health/ (F3, 2026-09-02): the rumour scan
// job (F2) needs the exact same "is this tracked job broken" evaluation
// features/job-health's own JobHealthBanner already does for the odds
// jobs, and CLAUDE.md's layer-boundary rule is explicit -- something two
// features both need belongs in shared/, not cross-imported from one
// feature into another.

export interface JobRunRow {
  jobName: string;
  status: "success" | "failure";
  finishedAt: string;
  error: string | null;
}

// How stale a tracked job's latest successful run can be before a caller
// should treat it as broken rather than merely between runs. Each caller
// picks its own multiple of its own cron cadence -- this default (3x the
// odds job's 2h cadence) is what features/job-health's banner uses;
// features/rumours picks its own multiple of the rumour job's 6h cadence
// instead of reusing this constant, since one missed tick means something
// different at each cadence.
export const STALE_THRESHOLD_HOURS = 6;

export type JobHealthStatus = { kind: "healthy" } | { kind: "degraded"; reasons: string[] };

/**
 * The actual "loud, never silent" decision (docs/user-flows.md, PROJECT_
 * FACTS.md): true when either (a) a tracked job's own execution looks
 * broken -- never run, its latest run failed, or its latest success is
 * older than staleThresholdHours -- or (b) missedSnapshotCount is above
 * zero. (b) exists because (a) alone can't see the real highest-impact
 * failure: a job that keeps succeeding every run while one specific
 * fight's odds event simply never appears in the feed (decideMatch's
 * no_candidates case) sits unpriced past T-12h forever, with no execution
 * failure to show for it. Callers with no equivalent outcome-based signal
 * (features/rumours) just pass 0.
 */
export function evaluateJobHealth(
  runs: JobRunRow[],
  trackedJobNames: readonly string[],
  missedSnapshotCount: number,
  now: Date,
  staleThresholdHours: number = STALE_THRESHOLD_HOURS,
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
    if (ageHours > staleThresholdHours) {
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
