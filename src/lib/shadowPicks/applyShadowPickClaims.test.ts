import { describe, expect, it } from "vitest";
import { applyShadowPickClaims } from "./applyShadowPickClaims";
import type { ShadowPickClaim, ShadowPickFacts, ShadowPickFighterFacts, ShadowPickFightFacts } from "./types";
import type { MappedUnit } from "../llm/runMapReduce";
import type { ShadowPickCardUnit } from "./types";

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
    fighter2: fighterFacts({ fighterId: "f2", name: "Fighter Two", ratedFightCount: 8 }),
    fighter1Price: null,
    fighter2Price: null,
    ...overrides,
  };
}

function facts(fights: ShadowPickFightFacts[]): ShadowPickFacts {
  return { eventId: "event-1", fightsById: new Map(fights.map((f) => [f.fightId, f])) };
}

function claim(overrides: Partial<ShadowPickClaim> = {}): ShadowPickClaim {
  return {
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
    ...overrides,
  };
}

function mapped(claims: ShadowPickClaim[], callLogId: string | null = "call-1"): MappedUnit<ShadowPickCardUnit, ShadowPickClaim>[] {
  return [{ unit: { eventId: "event-1" }, claims, source: "llm", callLogId }];
}

describe("applyShadowPickClaims", () => {
  it("anchors at 0.5 on an unpriced fight, with zero deltas, and produces exactly a coinflip for both lines", () => {
    const results = applyShadowPickClaims(mapped([claim()]), facts([fightFacts()]), "gemini");
    const assisted = results.find((r) => r.line === "LLM_ASSISTED")!;
    const only = results.find((r) => r.line === "LLM_ONLY")!;

    expect(assisted.predictedFighterId).toBe("f1"); // 0.5 ties toward fighter1, decideInternPick's own convention
    expect(assisted.probability).toBe(0.5);
    expect(assisted.confidence).toBe(1); // probability < 0.55 bands to confidence 1
    expect(assisted.signals).toEqual({ rumours: 0, elo: 0, size: 0, age: 0, sumDelta: 0 });

    expect(only.predictedFighterId).toBe("f1");
    expect(only.probability).toBe(0.5);
    expect(only.confidence).toBeNull();
    expect(only.signals).toBeNull();
  });

  it("applies deltas on top of a de-vigged market anchor to an exact value", () => {
    // odds_snapshots stores decimal odds (impliedProbability.ts: 1/decimalOdds,
    // no American-odds conversion anywhere in this codebase). 1.5 / 3.0 ->
    // raw1 = 2/3, raw2 = 1/3, no overround, so anchor1 = (2/3)/(2/3+1/3) = 2/3 exactly.
    const fight = fightFacts({ fighter1Price: 1.5, fighter2Price: 3.0 });
    const c = claim({
      fightId: "fight-1",
      restated: { ...claim().restated, fighter1Price: 1.5, fighter2Price: 3.0 },
      deltas: { rumours: 0.03, elo: 0.02, size: 0, age: 0 },
    });
    const results = applyShadowPickClaims(mapped([c]), facts([fight]), "gemini");
    const assisted = results.find((r) => r.line === "LLM_ASSISTED")!;

    const expectedProbability = 2 / 3 + 0.05;

    expect(assisted.probability).toBeCloseTo(expectedProbability, 10);
    expect(assisted.predictedFighterId).toBe("f1");
  });

  it("clamps a sum of deltas at exactly MAX_TOTAL_ADJUSTMENT (0.25), never applying the raw sum", () => {
    // Individually-legal deltas whose sum (0.12+0.11+0.02+0.01 = 0.26) would
    // normally be dropped by shadowPickClaimChecks.ts before this ever runs
    // -- this test proves the clamp is ALSO enforced here, defense-in-depth,
    // exactly mirroring decideInternPick.ts's own clamp line.
    const c = claim({ deltas: { rumours: 0.12, elo: 0.11, size: 0.02, age: 0.01 } });
    const results = applyShadowPickClaims(mapped([c]), facts([fightFacts()]), "gemini");
    const assisted = results.find((r) => r.line === "LLM_ASSISTED")!;

    expect(assisted.probability).toBe(0.75); // anchor 0.5 + clamped 0.25
    expect(assisted.signals!.sumDelta).toBe(0.25);
  });

  it("clamps a negative sum of deltas at exactly -MAX_TOTAL_ADJUSTMENT and picks fighter2", () => {
    const c = claim({ deltas: { rumours: -0.12, elo: -0.11, size: -0.02, age: -0.01 } });
    const results = applyShadowPickClaims(mapped([c]), facts([fightFacts()]), "gemini");
    const assisted = results.find((r) => r.line === "LLM_ASSISTED")!;

    expect(assisted.predictedFighterId).toBe("f2");
    expect(assisted.probability).toBe(0.75); // 1 - (0.5 - 0.25)
    expect(assisted.signals!.sumDelta).toBe(-0.25);
  });

  it("bands LLM_ASSISTED confidence down for a thin rated-fight sample, same rule decideInternPick.ts applies", () => {
    const thin = fightFacts({ fighter2: fighterFacts({ fighterId: "f2", ratedFightCount: 2 }) });
    const c = claim({ deltas: { rumours: 0.12, elo: 0.1, size: 0, age: 0 } }); // sum 0.22 -> probability 0.72 -> base band 4
    const results = applyShadowPickClaims(mapped([c]), facts([thin]), "gemini");
    const assisted = results.find((r) => r.line === "LLM_ASSISTED")!;

    expect(assisted.probability).toBe(0.72);
    expect(assisted.confidence).toBe(2); // minRatedFightCount=2 caps band 4 down to 2
  });

  it("LLM_ONLY reads the model's free probability directly, independent of the assisted clamp", () => {
    const c = claim({ freeProbabilityFighter1: 0.91, deltas: { rumours: 0, elo: 0, size: 0, age: 0 } });
    const results = applyShadowPickClaims(mapped([c]), facts([fightFacts()]), "gemini");
    const only = results.find((r) => r.line === "LLM_ONLY")!;

    expect(only.probability).toBe(0.91);
    expect(only.predictedFighterId).toBe("f1");
  });

  it("LLM_ONLY picks fighter2 and reports 1-p when the model's free probability favors fighter2", () => {
    const c = claim({ freeProbabilityFighter1: 0.2 });
    const results = applyShadowPickClaims(mapped([c]), facts([fightFacts()]), "gemini");
    const only = results.find((r) => r.line === "LLM_ONLY")!;

    expect(only.probability).toBe(0.8);
    expect(only.predictedFighterId).toBe("f2");
  });

  it("carries the map call's callLogId onto both result lines for traceability", () => {
    const results = applyShadowPickClaims(mapped([claim()], "call-xyz"), facts([fightFacts()]), "gemini");
    expect(results.every((r) => r.llmCallId === "call-xyz")).toBe(true);
  });

  it("produces exactly two rows (LLM_ASSISTED, LLM_ONLY) per claim, for every fight on the card", () => {
    const c2 = claim({ fightId: "fight-2" });
    const results = applyShadowPickClaims(
      mapped([claim(), c2]),
      facts([fightFacts(), fightFacts({ fightId: "fight-2" })]),
      "gemini",
    );
    expect(results).toHaveLength(4);
    expect(results.filter((r) => r.line === "LLM_ASSISTED")).toHaveLength(2);
    expect(results.filter((r) => r.line === "LLM_ONLY")).toHaveLength(2);
  });

  // O3 (Track B): `provider` is stamped from the explicit argument, not
  // inferred from anything about the claim -- this is the one new
  // behavior this pure function gained this phase.
  it("stamps every result row with the given provider, for either provider", () => {
    const geminiResults = applyShadowPickClaims(mapped([claim()]), facts([fightFacts()]), "gemini");
    expect(geminiResults.every((r) => r.provider === "gemini")).toBe(true);

    const groqResults = applyShadowPickClaims(mapped([claim()]), facts([fightFacts()]), "groq");
    expect(groqResults.every((r) => r.provider === "groq")).toBe(true);
  });
});
