import { describe, expect, it } from "vitest";
import { evaluateFightSettlement } from "./evaluateFightSettlement";
import type { FightSourceState } from "./evaluateFightSettlement";

// ARCHITECTURE.md Fork 6, the actual policy this function encodes:
//   - two or more sources agree -> settle ("both_agree")
//   - sources split with no majority -> never auto-settle, queue
//   - exactly two of three sources agree, third dissents -> settle on
//     the majority ("majority_2_of_3")
//   - only one source has reported after its timeout -> settle on it,
//     flagged (Wikipedia/API-Sports 24h; Sherdog 12h AND only when both
//     of the fighter's Sherdog pages corroborate -- "sherdog_only_12h")
// Plus the Wikipedia draw/NC refinement: a Wikipedia-only draw settles
// immediately (API-Sports structurally can never report "no winner"),
// but a source actively reporting a winner against it is a real
// disagreement and queues.
//
// J7 added Sherdog as the third source. Live check 2026-09-10: of ~860
// settled fights every one carries a SINGLE-source settled_from, so in
// practice Sherdog is the second source that actually shows up -- a
// Wikipedia+Sherdog agreement is the new fast path (settles without the
// 24h wait).
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
  sherdogWinnerId: null,
  sherdogMethod: null,
  sherdogRound: null,
  sherdogReportedAt: null,
  sherdogBilateral: false,
};

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();
}

describe("evaluateFightSettlement", () => {
  it("waits when no source has reported anything", () => {
    expect(evaluateFightSettlement(NOT_REPORTED, NOW)).toEqual({ action: "wait" });
  });

  it("settles immediately on a Wikipedia draw/NC when nothing else has an opinion", () => {
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

  it("queues when api_sports reports a winner while Wikipedia says draw/NC", () => {
    const state: FightSourceState = {
      ...NOT_REPORTED,
      wikipediaWinnerId: null,
      wikipediaMethod: "NC (overturned)",
      wikipediaRound: 3,
      wikipediaReportedAt: hoursAgo(0.1),
      apiSportsWinnerId: FIGHTER_A,
      apiSportsReportedAt: hoursAgo(0.1),
    };
    expect(evaluateFightSettlement(state, NOW)).toEqual({ action: "conflict" });
  });

  it("settles when Wikipedia and api_sports agree on the same winner", () => {
    const state: FightSourceState = {
      ...NOT_REPORTED,
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

  it("queues when Wikipedia and api_sports report different winners (no third source)", () => {
    const state: FightSourceState = {
      ...NOT_REPORTED,
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

  it("settles on Wikipedia alone once 24h have passed with no other report", () => {
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

  it("settles on api_sports alone once 24h have passed, with no method/round", () => {
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

  it("treats exactly 24h as past the timeout", () => {
    const state: FightSourceState = {
      ...NOT_REPORTED,
      wikipediaWinnerId: FIGHTER_A,
      wikipediaMethod: "Decision (unanimous)",
      wikipediaRound: 3,
      wikipediaReportedAt: hoursAgo(24),
    };
    expect(evaluateFightSettlement(state, NOW).action).toBe("settle");
  });

  // --- J7: Sherdog as the third source ---

  it("fast-path: Wikipedia + Sherdog agree -> settles now, no 24h wait", () => {
    const state: FightSourceState = {
      ...NOT_REPORTED,
      wikipediaWinnerId: FIGHTER_A,
      wikipediaMethod: "Submission (RNC)",
      wikipediaRound: 2,
      wikipediaReportedAt: hoursAgo(1),
      sherdogWinnerId: FIGHTER_A,
      sherdogMethod: "Submission (Rear-Naked Choke)",
      sherdogRound: 2,
      sherdogReportedAt: hoursAgo(0.5),
      sherdogBilateral: true,
    };
    expect(evaluateFightSettlement(state, NOW)).toEqual({
      action: "settle",
      winnerId: FIGHTER_A,
      method: "Submission (RNC)", // Wikipedia stays the method authority
      round: 2,
      settledFrom: "both_agree",
    });
  });

  it("Sherdog fills method/round when it settles alongside api_sports (which has none)", () => {
    const state: FightSourceState = {
      ...NOT_REPORTED,
      apiSportsWinnerId: FIGHTER_B,
      apiSportsReportedAt: hoursAgo(1),
      sherdogWinnerId: FIGHTER_B,
      sherdogMethod: "KO (Punches)",
      sherdogRound: 1,
      sherdogReportedAt: hoursAgo(1),
      sherdogBilateral: false,
    };
    expect(evaluateFightSettlement(state, NOW)).toEqual({
      action: "settle",
      winnerId: FIGHTER_B,
      method: "KO (Punches)",
      round: 1,
      settledFrom: "both_agree",
    });
  });

  it("majority: Wikipedia + Sherdog agree, api_sports dissents -> settle on the two", () => {
    const state: FightSourceState = {
      ...NOT_REPORTED,
      wikipediaWinnerId: FIGHTER_A,
      wikipediaMethod: "Decision (unanimous)",
      wikipediaRound: 3,
      wikipediaReportedAt: hoursAgo(1),
      apiSportsWinnerId: FIGHTER_B,
      apiSportsReportedAt: hoursAgo(1),
      sherdogWinnerId: FIGHTER_A,
      sherdogMethod: "Decision",
      sherdogRound: 3,
      sherdogReportedAt: hoursAgo(1),
      sherdogBilateral: true,
    };
    expect(evaluateFightSettlement(state, NOW)).toEqual({
      action: "settle",
      winnerId: FIGHTER_A,
      method: "Decision (unanimous)",
      round: 3,
      settledFrom: "majority_2_of_3",
    });
  });

  it("no majority: three sources, Wikipedia A / api B / Sherdog draw -> conflict", () => {
    const state: FightSourceState = {
      ...NOT_REPORTED,
      wikipediaWinnerId: FIGHTER_A,
      wikipediaMethod: "Decision (split)",
      wikipediaRound: 3,
      wikipediaReportedAt: hoursAgo(1),
      apiSportsWinnerId: FIGHTER_B,
      apiSportsReportedAt: hoursAgo(1),
      sherdogWinnerId: null,
      sherdogReportedAt: hoursAgo(1),
      sherdogBilateral: true,
    };
    expect(evaluateFightSettlement(state, NOW)).toEqual({ action: "conflict" });
  });

  it("Sherdog breaks a standing Wikipedia-vs-api tie -> majority_2_of_3", () => {
    const state: FightSourceState = {
      ...NOT_REPORTED,
      wikipediaWinnerId: FIGHTER_A,
      wikipediaMethod: "Decision (split)",
      wikipediaRound: 5,
      wikipediaReportedAt: hoursAgo(72),
      apiSportsWinnerId: FIGHTER_B,
      apiSportsReportedAt: hoursAgo(72),
      sherdogWinnerId: FIGHTER_B,
      sherdogMethod: "Decision (Split)",
      sherdogRound: 5,
      sherdogReportedAt: hoursAgo(2),
      sherdogBilateral: true,
    };
    const result = evaluateFightSettlement(state, NOW);
    expect(result).toMatchObject({ action: "settle", winnerId: FIGHTER_B, settledFrom: "majority_2_of_3" });
  });

  it("Wikipedia draw + Sherdog draw -> both_agree on a null winner", () => {
    const state: FightSourceState = {
      ...NOT_REPORTED,
      wikipediaWinnerId: null,
      wikipediaMethod: "Draw (majority)",
      wikipediaRound: 3,
      wikipediaReportedAt: hoursAgo(1),
      sherdogWinnerId: null,
      sherdogReportedAt: hoursAgo(1),
      sherdogBilateral: true,
    };
    expect(evaluateFightSettlement(state, NOW)).toEqual({
      action: "settle",
      winnerId: null,
      method: "Draw (majority)",
      round: 3,
      settledFrom: "both_agree",
    });
  });

  it("Sherdog alone, bilateral, 12h passed, nothing else -> sherdog_only_12h", () => {
    const state: FightSourceState = {
      ...NOT_REPORTED,
      sherdogWinnerId: FIGHTER_A,
      sherdogMethod: "TKO (Doctor Stoppage)",
      sherdogRound: 2,
      sherdogReportedAt: hoursAgo(12.1),
      sherdogBilateral: true,
    };
    expect(evaluateFightSettlement(state, NOW)).toEqual({
      action: "settle",
      winnerId: FIGHTER_A,
      method: "TKO (Doctor Stoppage)",
      round: 2,
      settledFrom: "sherdog_only_12h",
    });
  });

  it("Sherdog alone, bilateral, but only 6h passed -> wait", () => {
    const state: FightSourceState = {
      ...NOT_REPORTED,
      sherdogWinnerId: FIGHTER_A,
      sherdogMethod: "TKO",
      sherdogRound: 2,
      sherdogReportedAt: hoursAgo(6),
      sherdogBilateral: true,
    };
    expect(evaluateFightSettlement(state, NOW)).toEqual({ action: "wait" });
  });

  it("Sherdog alone, NOT bilateral -> waits forever (never settles alone one-sided)", () => {
    const state: FightSourceState = {
      ...NOT_REPORTED,
      sherdogWinnerId: FIGHTER_A,
      sherdogMethod: "TKO",
      sherdogRound: 2,
      sherdogReportedAt: hoursAgo(400),
      sherdogBilateral: false,
    };
    expect(evaluateFightSettlement(state, NOW)).toEqual({ action: "wait" });
  });

  it("one-sided Sherdog still corroborates Wikipedia (both_agree, no bilateral needed)", () => {
    const state: FightSourceState = {
      ...NOT_REPORTED,
      wikipediaWinnerId: FIGHTER_A,
      wikipediaMethod: "Decision (unanimous)",
      wikipediaRound: 3,
      wikipediaReportedAt: hoursAgo(2),
      sherdogWinnerId: FIGHTER_A,
      sherdogReportedAt: hoursAgo(1),
      sherdogBilateral: false,
    };
    expect(evaluateFightSettlement(state, NOW)).toMatchObject({
      action: "settle",
      settledFrom: "both_agree",
    });
  });
});
