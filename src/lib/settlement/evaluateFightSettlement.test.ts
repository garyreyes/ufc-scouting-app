import { describe, expect, it } from "vitest";
import { evaluateFightSettlement } from "./evaluateFightSettlement";
import type { FightSourceState } from "./evaluateFightSettlement";

// ARCHITECTURE.md Fork 6, the actual policy this function encodes:
//   - both sources agree -> settle
//   - sources disagree -> never auto-settle, queue
//   - only one source has reported after 24h -> settle on it, flagged
// Plus the two refinements found while writing this out (not guessed):
// a Wikipedia draw/NC settles immediately, not after 24h, since
// api_sports structurally can never report "no winner" at all (only a
// clear win or silence) -- but if api_sports HAS actively reported a
// winner while Wikipedia says draw/NC, that's a real disagreement
// between sources, not the "nothing to wait for" case, and must queue
// like any other disagreement.
const FIGHTER_A = "fighter-a";
const FIGHTER_B = "fighter-b";
const NOW = new Date("2026-09-10T00:00:00.000Z");

const NOT_REPORTED: FightSourceState = {
  wikipediaWinnerId: null,
  wikipediaMethod: null,
  wikipediaRound: null,
  wikipediaReportedAt: null,
  apiSportsWinnerId: null,
  apiSportsReportedAt: null,
};

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();
}

describe("evaluateFightSettlement", () => {
  it("waits when neither source has reported anything", () => {
    expect(evaluateFightSettlement(NOT_REPORTED, NOW)).toEqual({ action: "wait" });
  });

  it("settles immediately on a Wikipedia draw/NC when api_sports has no opinion at all", () => {
    const state: FightSourceState = {
      ...NOT_REPORTED,
      wikipediaWinnerId: null,
      wikipediaMethod: "NC (overturned)",
      wikipediaRound: 3,
      wikipediaReportedAt: hoursAgo(0.1),
    };
    expect(evaluateFightSettlement(state, NOW)).toEqual({
      action: "settle",
      winnerId: null,
      method: "NC (overturned)",
      round: 3,
      settledFrom: "wikipedia_draw_or_nc",
    });
  });

  it("queues instead of settling when api_sports actively reports a winner while Wikipedia says draw/NC", () => {
    const state: FightSourceState = {
      wikipediaWinnerId: null,
      wikipediaMethod: "NC (overturned)",
      wikipediaRound: 3,
      wikipediaReportedAt: hoursAgo(0.1),
      apiSportsWinnerId: FIGHTER_A,
      apiSportsReportedAt: hoursAgo(0.1),
    };
    expect(evaluateFightSettlement(state, NOW)).toEqual({ action: "conflict" });
  });

  it("settles when both sources agree on the same winner", () => {
    const state: FightSourceState = {
      wikipediaWinnerId: FIGHTER_A,
      wikipediaMethod: "Decision (unanimous)",
      wikipediaRound: 3,
      wikipediaReportedAt: hoursAgo(0.1),
      apiSportsWinnerId: FIGHTER_A,
      apiSportsReportedAt: hoursAgo(0.1),
    };
    expect(evaluateFightSettlement(state, NOW)).toEqual({
      action: "settle",
      winnerId: FIGHTER_A,
      method: "Decision (unanimous)",
      round: 3,
      settledFrom: "both_agree",
    });
  });

  it("queues instead of settling when both sources report different winners", () => {
    const state: FightSourceState = {
      wikipediaWinnerId: FIGHTER_A,
      wikipediaMethod: "Decision (split)",
      wikipediaRound: 3,
      wikipediaReportedAt: hoursAgo(0.1),
      apiSportsWinnerId: FIGHTER_B,
      apiSportsReportedAt: hoursAgo(0.1),
    };
    expect(evaluateFightSettlement(state, NOW)).toEqual({ action: "conflict" });
  });

  it("waits when only Wikipedia has reported a real winner and less than 24h have passed", () => {
    const state: FightSourceState = {
      ...NOT_REPORTED,
      wikipediaWinnerId: FIGHTER_A,
      wikipediaMethod: "Decision (unanimous)",
      wikipediaRound: 3,
      wikipediaReportedAt: hoursAgo(23.9),
    };
    expect(evaluateFightSettlement(state, NOW)).toEqual({ action: "wait" });
  });

  it("settles on Wikipedia alone once 24h have passed with no api_sports report", () => {
    const state: FightSourceState = {
      ...NOT_REPORTED,
      wikipediaWinnerId: FIGHTER_A,
      wikipediaMethod: "Decision (unanimous)",
      wikipediaRound: 3,
      wikipediaReportedAt: hoursAgo(24.1),
    };
    expect(evaluateFightSettlement(state, NOW)).toEqual({
      action: "settle",
      winnerId: FIGHTER_A,
      method: "Decision (unanimous)",
      round: 3,
      settledFrom: "wikipedia_only_24h",
    });
  });

  it("waits when only api_sports has reported and less than 24h have passed", () => {
    const state: FightSourceState = {
      ...NOT_REPORTED,
      apiSportsWinnerId: FIGHTER_A,
      apiSportsReportedAt: hoursAgo(23.9),
    };
    expect(evaluateFightSettlement(state, NOW)).toEqual({ action: "wait" });
  });

  it("settles on api_sports alone once 24h have passed, with no method/round (api_sports never has them)", () => {
    const state: FightSourceState = {
      ...NOT_REPORTED,
      apiSportsWinnerId: FIGHTER_A,
      apiSportsReportedAt: hoursAgo(24.1),
    };
    expect(evaluateFightSettlement(state, NOW)).toEqual({
      action: "settle",
      winnerId: FIGHTER_A,
      method: null,
      round: null,
      settledFrom: "api_sports_only_24h",
    });
  });

  it("treats exactly 24h as past the timeout, not still waiting", () => {
    const state: FightSourceState = {
      ...NOT_REPORTED,
      wikipediaWinnerId: FIGHTER_A,
      wikipediaMethod: "Decision (unanimous)",
      wikipediaRound: 3,
      wikipediaReportedAt: hoursAgo(24),
    };
    expect(evaluateFightSettlement(state, NOW).action).toBe("settle");
  });
});
