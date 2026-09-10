import { describe, expect, it } from "vitest";
import {
  matchSherdogFightResult,
  type FightForSherdogMatch,
  type SherdogBoutForMatch,
} from "./matchSherdogFightResult";

const FIGHT: FightForSherdogMatch = {
  fighter1_id: "app-a",
  fighter1_sherdog_id: 1001,
  fighter2_id: "app-b",
  fighter2_sherdog_id: 2002,
  event_date: "2026-09-19",
};

function bout(over: Partial<SherdogBoutForMatch>): SherdogBoutForMatch {
  return {
    fighter_id: "app-a",
    opponent_sherdog_id: 2002,
    result: "win",
    event_date: "2026-09-19",
    method: "Decision (Unanimous)",
    round: 3,
    ...over,
  };
}

describe("matchSherdogFightResult", () => {
  it("returns no_data when either fighter is not Sherdog-linked", () => {
    expect(
      matchSherdogFightResult({ ...FIGHT, fighter1_sherdog_id: null }, [bout({})]).status,
    ).toBe("no_data");
    expect(
      matchSherdogFightResult({ ...FIGHT, fighter2_sherdog_id: null }, [bout({})]).status,
    ).toBe("no_data");
  });

  it("returns no_data when neither fighter's history has the bout", () => {
    const bouts = [
      bout({ fighter_id: "app-a", opponent_sherdog_id: 9999 }),
      bout({ fighter_id: "app-b", opponent_sherdog_id: 8888 }),
    ];
    expect(matchSherdogFightResult(FIGHT, bouts).status).toBe("no_data");
  });

  it("matches from fighter1's page alone (not bilateral)", () => {
    const bouts = [bout({ fighter_id: "app-a", opponent_sherdog_id: 2002, result: "win" })];
    const result = matchSherdogFightResult(FIGHT, bouts);
    expect(result).toEqual({
      status: "matched",
      winnerId: "app-a",
      method: "Decision (Unanimous)",
      round: 3,
      bilateral: false,
    });
  });

  it("matches from fighter2's page alone, mapping loss -> fighter1 win", () => {
    const bouts = [
      bout({ fighter_id: "app-b", opponent_sherdog_id: 1001, result: "loss", method: "KO (Punch)", round: 1 }),
    ];
    const result = matchSherdogFightResult(FIGHT, bouts);
    expect(result).toMatchObject({ status: "matched", winnerId: "app-a", bilateral: false });
  });

  it("is bilateral when both fighters' pages agree", () => {
    const bouts = [
      bout({ fighter_id: "app-a", opponent_sherdog_id: 2002, result: "loss" }),
      bout({ fighter_id: "app-b", opponent_sherdog_id: 1001, result: "win" }),
    ];
    const result = matchSherdogFightResult(FIGHT, bouts);
    expect(result).toMatchObject({ status: "matched", winnerId: "app-b", bilateral: true });
  });

  it("is ambiguous when the two fighters' pages disagree", () => {
    const bouts = [
      bout({ fighter_id: "app-a", opponent_sherdog_id: 2002, result: "win" }),
      bout({ fighter_id: "app-b", opponent_sherdog_id: 1001, result: "win" }),
    ];
    const result = matchSherdogFightResult(FIGHT, bouts);
    expect(result.status).toBe("ambiguous");
  });

  it("maps a draw to a null winner (bilateral)", () => {
    const bouts = [
      bout({ fighter_id: "app-a", opponent_sherdog_id: 2002, result: "draw" }),
      bout({ fighter_id: "app-b", opponent_sherdog_id: 1001, result: "draw" }),
    ];
    const result = matchSherdogFightResult(FIGHT, bouts);
    expect(result).toMatchObject({ status: "matched", winnerId: null, bilateral: true });
  });

  it("treats no-contest as a null winner", () => {
    const bouts = [bout({ fighter_id: "app-a", opponent_sherdog_id: 2002, result: "nc" })];
    expect(matchSherdogFightResult(FIGHT, bouts)).toMatchObject({ status: "matched", winnerId: null });
  });

  it("falls back to the other page when one side's result is 'unknown'", () => {
    const bouts = [
      bout({ fighter_id: "app-a", opponent_sherdog_id: 2002, result: "unknown" }),
      bout({ fighter_id: "app-b", opponent_sherdog_id: 1001, result: "loss" }),
    ];
    const result = matchSherdogFightResult(FIGHT, bouts);
    expect(result).toMatchObject({ status: "matched", winnerId: "app-a", bilateral: false });
  });

  it("is ambiguous when the only bout on record has an unknown result", () => {
    const bouts = [bout({ fighter_id: "app-a", opponent_sherdog_id: 2002, result: "unknown" })];
    expect(matchSherdogFightResult(FIGHT, bouts).status).toBe("ambiguous");
  });

  it("ignores a bout outside the date-skew window (different meeting)", () => {
    const bouts = [bout({ fighter_id: "app-a", opponent_sherdog_id: 2002, event_date: "2024-03-02" })];
    expect(matchSherdogFightResult(FIGHT, bouts).status).toBe("no_data");
  });

  it("accepts a bout a few days off (Sherdog's date vs the event row's date)", () => {
    const bouts = [bout({ fighter_id: "app-a", opponent_sherdog_id: 2002, event_date: "2026-09-21" })];
    expect(matchSherdogFightResult(FIGHT, bouts).status).toBe("matched");
  });

  it("is ambiguous when a fighter has two in-window bouts vs the same opponent (rematch)", () => {
    const bouts = [
      bout({ fighter_id: "app-a", opponent_sherdog_id: 2002, event_date: "2026-09-19", result: "win" }),
      bout({ fighter_id: "app-a", opponent_sherdog_id: 2002, event_date: "2026-09-15", result: "loss" }),
    ];
    const result = matchSherdogFightResult(FIGHT, bouts);
    expect(result.status).toBe("ambiguous");
  });

  it("excludes a candidate bout with no event_date at all", () => {
    const bouts = [bout({ fighter_id: "app-a", opponent_sherdog_id: 2002, event_date: null })];
    expect(matchSherdogFightResult(FIGHT, bouts).status).toBe("no_data");
  });
});
