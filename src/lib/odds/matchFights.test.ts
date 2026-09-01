import { describe, expect, it } from "vitest";
import {
  decideMatch,
  isWithinCardWindow,
  rankFightMatches,
  scoreFightMatch,
  scoreOddsEventMatch,
} from "./matchFights";
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

// The inverse direction, built for B4: given one local fight, find its
// best-matching odds event among many. Same underlying scoring as
// scoreFightMatch (shared via fightNameSimilarity), so these tests focus
// on the direction actually being reversed correctly rather than
// re-testing name-similarity edge cases already covered above.
describe("scoreOddsEventMatch", () => {
  it("finds the matching odds event among several candidates", () => {
    const decoy1 = oddsEvent({ id: "decoy-1", home_team: "Nobody Relevant", away_team: "Also Nobody" });
    const decoy2 = oddsEvent({ id: "decoy-2", home_team: "Someone Else", away_team: "Another Person" });
    const real = oddsEvent(); // exact match for the default fight fixture
    const result = scoreOddsEventMatch(fight(), [decoy1, decoy2, real]);
    expect(result).not.toBeNull();
    expect(result?.oddsEvent.id).toBe(real.id);
    expect(result?.confidence).toBe(1);
  });

  it("returns null when no odds event falls within the fight's date window", () => {
    const farEvent = oddsEvent({ commence_time: "2027-01-01T00:00:00Z" });
    expect(scoreOddsEventMatch(fight(), [farEvent])).toBeNull();
  });

  it("returns null when given an empty odds event list", () => {
    expect(scoreOddsEventMatch(fight(), [])).toBeNull();
  });

  it("picks the higher-confidence odds event when more than one falls in the window", () => {
    const weak = oddsEvent({ id: "weak", home_team: "Nobody Relevant", away_team: "Also Nobody" });
    const strong = oddsEvent({ id: "strong" });
    const result = scoreOddsEventMatch(fight(), [weak, strong]);
    expect(result?.oddsEvent.id).toBe("strong");
  });
});

// Built for B6's low-confidence conflict resolution screen: unlike
// scoreFightMatch (single best guess only), this returns EVERY candidate
// in the window so the owner can correct the algorithm's own guess rather
// than being railroaded into it -- "never auto-merge on a guess" applies
// to the review screen too, not just the automatic path.
describe("rankFightMatches", () => {
  it("returns every in-window candidate, sorted by confidence descending", () => {
    const weak = fight({ id: "weak", fighter1Name: "Nobody Relevant", fighter2Name: "Also Nobody" });
    const strong = fight({ id: "strong" }); // exact match
    const result = rankFightMatches(oddsEvent(), [weak, strong]);
    expect(result.map((r) => r.fightId)).toEqual(["strong", "weak"]);
    expect(result[0].confidence).toBeGreaterThan(result[1].confidence);
  });

  it("excludes candidates outside the date window entirely", () => {
    const inWindow = fight({ id: "in-window" });
    const outOfWindow = fight({ id: "out-of-window", eventDate: "2027-01-01" });
    const result = rankFightMatches(oddsEvent(), [inWindow, outOfWindow]);
    expect(result.map((r) => r.fightId)).toEqual(["in-window"]);
  });

  it("returns an empty array, not null, when nothing is in the window", () => {
    const result = rankFightMatches(oddsEvent(), [fight({ eventDate: "2027-01-01" })]);
    expect(result).toEqual([]);
  });
});
