import { describe, expect, it } from "vitest";
import { evaluateJobHealth, STALE_THRESHOLD_HOURS } from "./evaluateJobHealth";
import type { JobRunRow } from "./types";

const TRACKED = ["discover_start_times", "odds_snapshot"] as const;
const NOW = new Date("2026-09-20T00:00:00Z");

function run(overrides: Partial<JobRunRow> = {}): JobRunRow {
  return {
    jobName: "discover_start_times",
    status: "success",
    finishedAt: "2026-09-20T00:00:00Z", // just now, by default
    error: null,
    ...overrides,
  };
}

describe("evaluateJobHealth", () => {
  it("is healthy when every tracked job's latest run succeeded recently", () => {
    const runs = [
      run({ jobName: "discover_start_times" }),
      run({ jobName: "odds_snapshot" }),
    ];
    const result = evaluateJobHealth(runs, TRACKED, 0, NOW);
    expect(result.kind).toBe("healthy");
  });

  it("is degraded when a tracked job's latest run failed", () => {
    const runs = [
      run({ jobName: "discover_start_times" }),
      run({ jobName: "odds_snapshot", status: "failure", error: "boom" }),
    ];
    const result = evaluateJobHealth(runs, TRACKED, 0, NOW);
    expect(result.kind).toBe("degraded");
    if (result.kind === "degraded") {
      expect(result.reasons.some((r) => r.includes("odds_snapshot") && r.includes("boom"))).toBe(
        true,
      );
    }
  });

  it("is degraded when a tracked job has never run at all", () => {
    const runs = [run({ jobName: "discover_start_times" })]; // odds_snapshot missing entirely
    const result = evaluateJobHealth(runs, TRACKED, 0, NOW);
    expect(result.kind).toBe("degraded");
    if (result.kind === "degraded") {
      expect(result.reasons.some((r) => r.includes("odds_snapshot"))).toBe(true);
    }
  });

  it(`is degraded when the latest successful run is older than ${STALE_THRESHOLD_HOURS}h`, () => {
    const staleTime = new Date(NOW.getTime() - (STALE_THRESHOLD_HOURS + 1) * 3_600_000).toISOString();
    const runs = [
      run({ jobName: "discover_start_times", finishedAt: staleTime }),
      run({ jobName: "odds_snapshot" }),
    ];
    const result = evaluateJobHealth(runs, TRACKED, 0, NOW);
    expect(result.kind).toBe("degraded");
  });

  it(`is healthy exactly at the ${STALE_THRESHOLD_HOURS}h staleness boundary`, () => {
    const boundaryTime = new Date(NOW.getTime() - STALE_THRESHOLD_HOURS * 3_600_000).toISOString();
    const runs = [
      run({ jobName: "discover_start_times", finishedAt: boundaryTime }),
      run({ jobName: "odds_snapshot" }),
    ];
    const result = evaluateJobHealth(runs, TRACKED, 0, NOW);
    expect(result.kind).toBe("healthy");
  });

  it("is degraded when missedSnapshotCount is above zero, even if every job succeeded recently", () => {
    // The real gap job-execution health alone can't see: the job keeps
    // succeeding every run, but a specific fight's odds event never shows
    // up in the feed (decideMatch's no_candidates case), so it sits
    // unpriced past its T-12h window indefinitely.
    const runs = [run({ jobName: "discover_start_times" }), run({ jobName: "odds_snapshot" })];
    const result = evaluateJobHealth(runs, TRACKED, 2, NOW);
    expect(result.kind).toBe("degraded");
    if (result.kind === "degraded") {
      expect(result.reasons.some((r) => r.includes("2"))).toBe(true);
    }
  });
});
