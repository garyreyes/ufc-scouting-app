import { describe, expect, it } from "vitest";
import { earliestConfirmedStartTime } from "./discoverStartTimes";
import type { FightForMatching, OddsEvent } from "./types";

function oddsEvent(overrides: Partial<OddsEvent> = {}): OddsEvent {
  return {
    id: "id",
    commence_time: "2026-09-20T04:00:00Z",
    home_team: "Alexandre Pantoja",
    away_team: "Joshua Van",
    bookmakers: [],
    ...overrides,
  };
}

function fight(overrides: Partial<FightForMatching> = {}): FightForMatching {
  return {
    id: "fight-1",
    eventDate: "2026-09-19",
    fighter1Name: "Joshua Van",
    fighter2Name: "Alexandre Pantoja",
    ...overrides,
  };
}

describe("earliestConfirmedStartTime", () => {
  it("returns null for a card with no fights at all", () => {
    expect(earliestConfirmedStartTime([], [oddsEvent()])).toBeNull();
  });

  it("returns null when no fight has a confident match", () => {
    const unrelated = oddsEvent({ home_team: "Nobody Relevant", away_team: "Also Nobody" });
    expect(earliestConfirmedStartTime([fight()], [unrelated])).toBeNull();
  });

  // The actual point of this function: a card's prelims start well before
  // its main event. The EARLIEST confident match, not the main event's own
  // time, is what the pick lock (C1) needs.
  it("picks the earliest commence_time among several confidently-matched fights", () => {
    const mainEvent = fight({
      id: "main-event",
      fighter1Name: "Joshua Van",
      fighter2Name: "Alexandre Pantoja",
    });
    const prelim = fight({
      id: "prelim-1",
      fighter1Name: "Merab Dvalishvili",
      fighter2Name: "Petr Yan",
    });

    const mainEventOdds = oddsEvent({
      id: "odds-main",
      commence_time: "2026-09-20T04:00:00Z", // late
      home_team: "Joshua Van",
      away_team: "Alexandre Pantoja",
    });
    const prelimOdds = oddsEvent({
      id: "odds-prelim",
      commence_time: "2026-09-19T23:00:00Z", // earlier -- this is the real card start
      home_team: "Merab Dvalishvili",
      away_team: "Petr Yan",
    });

    const result = earliestConfirmedStartTime(
      [mainEvent, prelim],
      [mainEventOdds, prelimOdds],
    );
    expect(result).toBe("2026-09-19T23:00:00Z");
  });

  it("excludes low-confidence matches from consideration, even if they'd be earlier", () => {
    const realFight = fight({
      id: "real",
      fighter1Name: "Joshua Van",
      fighter2Name: "Alexandre Pantoja",
    });
    const speculativeFight = fight({
      id: "speculative",
      fighter1Name: "Some Prospect",
      fighter2Name: "Another Prospect",
    });

    const realOdds = oddsEvent({
      id: "odds-real",
      commence_time: "2026-09-20T04:00:00Z",
      home_team: "Joshua Van",
      away_team: "Alexandre Pantoja",
    });
    // Wrong pairing for speculativeFight -- shares nothing, so this scores
    // low. If it were wrongly included, its earlier time would win.
    const wrongOdds = oddsEvent({
      id: "odds-wrong",
      commence_time: "2026-09-18T00:00:00Z",
      home_team: "Completely Different Person",
      away_team: "Yet Another Person",
      // must still fall in the fight's date window to even be a candidate
    });

    const result = earliestConfirmedStartTime(
      [realFight, speculativeFight],
      [realOdds, wrongOdds],
    );
    expect(result).toBe("2026-09-20T04:00:00Z");
  });

  it("is order-independent -- same result regardless of input array order", () => {
    const a = fight({ id: "a", fighter1Name: "Joshua Van", fighter2Name: "Alexandre Pantoja" });
    const b = fight({ id: "b", fighter1Name: "Merab Dvalishvili", fighter2Name: "Petr Yan" });
    const oddsA = oddsEvent({
      id: "odds-a",
      commence_time: "2026-09-20T04:00:00Z",
      home_team: "Joshua Van",
      away_team: "Alexandre Pantoja",
    });
    const oddsB = oddsEvent({
      id: "odds-b",
      commence_time: "2026-09-19T23:00:00Z",
      home_team: "Merab Dvalishvili",
      away_team: "Petr Yan",
    });

    const forward = earliestConfirmedStartTime([a, b], [oddsA, oddsB]);
    const backward = earliestConfirmedStartTime([b, a], [oddsB, oddsA]);
    expect(forward).toBe(backward);
    expect(forward).toBe("2026-09-19T23:00:00Z");
  });
});
