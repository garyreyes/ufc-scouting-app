import { describe, expect, it } from "vitest";
import { extractFightIdsFromRawOutput, replayLlmCall } from "./replayLlmCall";
import type { ShadowPickFacts, ShadowPickFighterFacts, ShadowPickFightFacts } from "./types";

function fighterFacts(overrides: Partial<ShadowPickFighterFacts> = {}): ShadowPickFighterFacts {
  return {
    fighterId: "f1",
    name: "Fighter One",
    eloRating: 1550,
    ratedFightCount: 8,
    reachCm: 170,
    heightCm: 165,
    ageYears: 30,
    sherdogWins: 10,
    sherdogLosses: 2,
    dossier: { formTrajectory: "", stylisticProfile: "", durability: "", layoff: "" },
    recentBouts: [],
    openFlags: [],
    ...overrides,
  };
}

function fightFacts(overrides: Partial<ShadowPickFightFacts> = {}): ShadowPickFightFacts {
  return {
    fightId: "fight-1",
    fighter1: fighterFacts({ fighterId: "f1", name: "Fighter One" }),
    fighter2: fighterFacts({ fighterId: "f2", name: "Fighter Two" }),
    fighter1Price: null,
    fighter2Price: null,
    ...overrides,
  };
}

function facts(fights: ShadowPickFightFacts[]): ShadowPickFacts {
  return { eventId: "event-1", fightsById: new Map(fights.map((f) => [f.fightId, f])) };
}

const VALID_RAW_OUTPUT = JSON.stringify({
  picks: [
    {
      fightId: "fight-1",
      restated: {
        fighter1Elo: 1550,
        fighter2Elo: 1550,
        fighter1Reach: 170,
        fighter2Reach: 170,
        fighter1Height: 165,
        fighter2Height: 165,
        fighter1Age: 30,
        fighter2Age: 30,
        fighter1Wins: 10,
        fighter1Losses: 2,
        fighter2Wins: 10,
        fighter2Losses: 2,
        fighter1Price: null,
        fighter2Price: null,
      },
      deltas: { rumours: 0, elo: 0, size: 0, age: 0 },
      freeProbabilityFighter1: 0.5,
      citedBoutIds: [],
      citedFlagIds: [],
      reasoning: "Even matchup.",
    },
  ],
});

describe("replayLlmCall", () => {
  it("runs the real parse -> verify -> apply pipeline over a stored raw response, producing both lines", () => {
    const outcome = replayLlmCall(VALID_RAW_OUTPUT, "event-1", "call-1", facts([fightFacts()]));

    expect(outcome.claimsProposed).toBe(1);
    expect(outcome.claimsKept).toBe(1);
    expect(outcome.results).toHaveLength(2);
    expect(outcome.results.every((r) => r.llmCallId === "call-1")).toBe(true);
  });

  it("drops a claim whose restated numbers no longer match current facts, same as a live run would", () => {
    // reachCm now 999 in current facts, but the stored response restated 170 --
    // the exact drift scenario N9's replay is built to surface.
    const drifted = facts([fightFacts({ fighter1: fighterFacts({ fighterId: "f1", reachCm: 999 }) })]);
    const outcome = replayLlmCall(VALID_RAW_OUTPUT, "event-1", "call-1", drifted);

    expect(outcome.claimsKept).toBe(0);
    expect(outcome.results).toHaveLength(0);
    expect(outcome.dropReasons.numeric_mismatch).toBe(1);
  });

  it("throws on genuinely malformed JSON, same as parseShadowPicksResponse would for a live call", () => {
    expect(() => replayLlmCall("not json", "event-1", "call-1", facts([fightFacts()]))).toThrow();
  });
});

describe("extractFightIdsFromRawOutput", () => {
  it("finds every distinct fightId in a well-formed response", () => {
    const raw = JSON.stringify({ picks: [{ fightId: "a" }, { fightId: "b" }, { fightId: "a" }] });
    expect(extractFightIdsFromRawOutput(raw)).toEqual(["a", "b"]);
  });

  it("returns [] for genuinely malformed JSON, rather than throwing -- this is the lenient fallback path", () => {
    expect(extractFightIdsFromRawOutput("not json")).toEqual([]);
  });

  it("returns [] when picks is missing or not an array", () => {
    expect(extractFightIdsFromRawOutput(JSON.stringify({}))).toEqual([]);
    expect(extractFightIdsFromRawOutput(JSON.stringify({ picks: "nope" }))).toEqual([]);
  });

  it("skips picks with a missing or non-string fightId instead of throwing", () => {
    const raw = JSON.stringify({ picks: [{}, { fightId: 123 }, { fightId: "real" }] });
    expect(extractFightIdsFromRawOutput(raw)).toEqual(["real"]);
  });
});
