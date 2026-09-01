import { describe, expect, it } from "vitest";
import { buildSourceReportUpdate } from "./buildSourceReportUpdate";

// This is the function the entire 24h single-source settlement timeout
// depends on (evaluateFightSettlement.ts, lib/settlement/). The one thing
// it must never do is refresh reported_at once it's set -- the sync jobs
// run twice daily, so if reported_at reset on every re-report the timeout
// would never actually fire. That single guarantee is the point of every
// test below.
const NOW = "2026-09-10T00:00:00.000Z";
const FIGHTER_A = "fighter-a";
const NO_EXISTING = { wikipediaReportedAt: null, apiSportsReportedAt: null };

describe("buildSourceReportUpdate — wikipedia", () => {
  it("returns no update when the bout hasn't happened yet (method still null)", () => {
    const result = buildSourceReportUpdate(
      { source: "wikipedia", winnerId: null, method: null, round: null },
      NO_EXISTING,
      NOW,
    );
    expect(result).toEqual({});
  });

  it("first report: sets reported_at to now and carries the result", () => {
    const result = buildSourceReportUpdate(
      { source: "wikipedia", winnerId: FIGHTER_A, method: "Decision (unanimous)", round: 3 },
      NO_EXISTING,
      NOW,
    );
    expect(result).toEqual({
      wikipedia_winner_id: FIGHTER_A,
      wikipedia_method: "Decision (unanimous)",
      wikipedia_round: 3,
      wikipedia_reported_at: NOW,
    });
  });

  it("a draw/NC report (method set, no winner) still counts as reported", () => {
    const result = buildSourceReportUpdate(
      { source: "wikipedia", winnerId: null, method: "NC (overturned)", round: 3 },
      NO_EXISTING,
      NOW,
    );
    expect(result.wikipedia_winner_id).toBeNull();
    expect(result.wikipedia_method).toBe("NC (overturned)");
    expect(result.wikipedia_reported_at).toBe(NOW);
  });

  it("a repeat report preserves the ORIGINAL reported_at, not now", () => {
    const originalReportedAt = "2026-09-01T00:00:00.000Z";
    const result = buildSourceReportUpdate(
      { source: "wikipedia", winnerId: FIGHTER_A, method: "Decision (unanimous)", round: 3 },
      { wikipediaReportedAt: originalReportedAt, apiSportsReportedAt: null },
      NOW,
    );
    expect(result.wikipedia_reported_at).toBe(originalReportedAt);
  });

  it("a corrected result (e.g. overturned after appeal) still refreshes winner/method/round, just not the clock", () => {
    const originalReportedAt = "2026-09-01T00:00:00.000Z";
    const result = buildSourceReportUpdate(
      { source: "wikipedia", winnerId: null, method: "NC (overturned)", round: 3 },
      { wikipediaReportedAt: originalReportedAt, apiSportsReportedAt: null },
      NOW,
    );
    expect(result.wikipedia_winner_id).toBeNull();
    expect(result.wikipedia_method).toBe("NC (overturned)");
    expect(result.wikipedia_reported_at).toBe(originalReportedAt);
  });
});

describe("buildSourceReportUpdate — api_sports", () => {
  it("returns no update when there's no winner yet (indistinguishable from 'hasn't happened')", () => {
    const result = buildSourceReportUpdate({ source: "api_sports", winnerId: null, method: null, round: null }, NO_EXISTING, NOW);
    expect(result).toEqual({});
  });

  it("first report: sets reported_at to now and carries the winner (no method/round -- api_sports never has them)", () => {
    const result = buildSourceReportUpdate(
      { source: "api_sports", winnerId: FIGHTER_A, method: null, round: null },
      NO_EXISTING,
      NOW,
    );
    expect(result).toEqual({
      api_sports_winner_id: FIGHTER_A,
      api_sports_reported_at: NOW,
    });
  });

  it("a repeat report preserves the ORIGINAL reported_at, not now", () => {
    const originalReportedAt = "2026-09-01T00:00:00.000Z";
    const result = buildSourceReportUpdate(
      { source: "api_sports", winnerId: FIGHTER_A, method: null, round: null },
      { wikipediaReportedAt: null, apiSportsReportedAt: originalReportedAt },
      NOW,
    );
    expect(result.api_sports_reported_at).toBe(originalReportedAt);
  });
});
