import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Runs one background job and records exactly one job_runs row for it,
 * success or failure -- so a missed or broken schedule shows up as a
 * banner (features/job-health) instead of a silent gap. Built for B5's
 * odds jobs, written generically because Phase F's rumour engine needs the
 * identical bookkeeping later.
 *
 * Always rethrows the original error after recording it, so the caller
 * (a GitHub Actions step) still fails loudly too -- the job_runs row and
 * the CI red X are both signals, and neither should paper over the other.
 */
export async function runWithTracking<T>(
  supabase: SupabaseClient,
  jobName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = new Date().toISOString();

  try {
    const result = await fn();
    // The job itself already succeeded -- a failure to log that must not
    // turn into a false "job failed" row or a failed CI step, so this is
    // deliberately not `throw error` the way the fetch/write calls inside
    // fn() are expected to be.
    const { error } = await supabase.from("job_runs").insert({
      job_name: jobName,
      status: "success",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      summary: result,
    });
    if (error) console.error(`job_runs logging failed for ${jobName}:`, error);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await supabase.from("job_runs").insert({
        job_name: jobName,
        status: "failure",
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        error: message,
      });
    } catch {
      // A logging failure must never mask the real error below.
    }
    throw err;
  }
}
