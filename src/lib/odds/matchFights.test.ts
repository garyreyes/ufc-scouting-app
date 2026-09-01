import { describe, expect, it } from "vitest";
import { decideMatch, isWithinCardWindow, scoreFightMatch } from "./matchFights";
import type { FightForMatching, OddsEvent } from "./types";

function oddsEvent(overrides: Partial<OddsEvent> = {}): OddsEvent {
  return {
    id: "097259d4c82c4ae646995fc8d665c410",
    commence_time: "2026-09-20T04:00:00Z", // real UFC 331 main event, captured live
    home_team: "Alexandre Pantoja",
    away_team: "Joshua Van",
    bookmakers: [],
    ...overrides,
  };
}

function fight(overrides: Partial<FightForMatching> = {}): FightForMatching {
  return {
    id: "fight-1",
    eventDate: "2026-09-19", // real Wikipedia-sourced UFC 331 date
    fighter1Name: "Joshua Van",
    fighter2Name: "Alexandre Pantoja",
    ...overrides,
  };
}

describe("isWithinCardWindow", () => {
  it("accepts the real UFC 331 gap (28h) between commence_time and event_date", () => {
    expect(isWithinCardWindow("2026-09-20T04:00:00Z", "2026-09-19")).toBe(true);
  });

  it("rejects a commence_time a week later", () => {
    expect(isWithinCardWindow("2026-09-27T04:00:00Z", "2026-09-19")).toBe(false);
  });

  it("is symmetric around the boundary", () => {
    // 36h exactly should pass; just over should not.
    expect(isWithinCardWindow("2026-09-20T12:00:00Z", "2026-09-19")).toBe(true);
    expect(isWithinCardWindow("2026-09-20T12:00:01Z", "2026-09-19")).toBe(false);
  });
});

describe("scoreFightMatch", () => {
  it("matches on exact names within the window, regardless of home/away order", () => {
    const result = scoreFightMatch(oddsEvent(), [fight()]);
    expect(result).not.toBeNull();
    expect(result?.fightId).toBe("fight-1");
    expect(result?.confidence).toBe(1);
  });

  it("returns null when no candidate falls within the date window", () => {
    const farFight = fight({ eventDate: "2026-01-01" });
    expect(scoreFightMatch(oddsEvent(), [farFight])).toBeNull();
  });

  // The actual scenario found live 2026-09-01: the odds feed listed the
  // same fighter against multiple different opponents on one speculative
  // date. If a real, different fight is in our DB for the SAME window,
  // sharing only one fighter must not score anywhere near a full match.
  it("scores a rumoured-matchup collision (one shared fighter, wrong opponent) far below an exact match", () => {
    const rumouredEvent = oddsEvent({
      home_team: "Justin Gaethje",
      away_team: "Ilia Topuria",
    });
    const realLocalFight = fight({
      fighter1Name: "Justin Gaethje",
      fighter2Name: "Arman Tsarukyan", // a different, real opponent
    });
    const result = scoreFightMatch(rumouredEvent, [realLocalFight]);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeLessThan(0.6);
  });

  it("picks the higher-confidence candidate when more than one falls in the window", () => {
    const weak = fight({ id: "weak", fighter1Name: "Nobody Relevant", fighter2Name: "Also Nobody" });
    const strong = fight({ id: "strong" }); // exact match, from the default fixture
    const result = scoreFightMatch(oddsEvent(), [weak, strong]);
    expect(result?.fightId).toBe("strong");
  });
});

describe("decideMatch", () => {
  it("auto-matches an exact name match within the window", () => {
    const decision = decideMatch(oddsEvent(), [fight()]);
    expect(decision.kind).toBe("matched");
  });

  it("queues a low-confidence match rather than guessing", () => {
    const rumouredEvent = oddsEvent({ home_team: "Justin Gaethje", away_team: "Ilia Topuria" });
    const realLocalFight = fight({ fighter1Name: "Justin Gaethje", fighter2Name: "Arman Tsarukyan" });
    const decision = decideMatch(rumouredEvent, [realLocalFight]);
    expect(decision.kind).toBe("low_confidence");
  });

  it("reports no_candidates, not a conflict, when nothing is in the window at all", () => {
    const decision = decideMatch(oddsEvent(), [fight({ eventDate: "2027-01-01" })]);
    expect(decision.kind).toBe("no_candidates");
  });
});
