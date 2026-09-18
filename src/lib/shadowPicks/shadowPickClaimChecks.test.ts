import { describe, expect, it } from "vitest";
import { verifyClaims } from "../llm/verifyClaims";
import { shadowPickClaimChecks } from "./shadowPickClaimChecks";
import type { ShadowPickClaim, ShadowPickFacts, ShadowPickFighterFacts, ShadowPickFightFacts } from "./types";

function fighterFacts(overrides: Partial<ShadowPickFighterFacts> = {}): ShadowPickFighterFacts {
  return {
    fighterId: "f1",
    name: "Alexandre Pantoja",
    eloRating: 1550.4,
    ratedFightCount: 8,
    reachCm: 170,
    heightCm: 165,
    ageYears: 34,
    sherdogWins: 13,
    sherdogLosses: 4,
    dossier: {
      formTrajectory: "Won two straight.",
      stylisticProfile: "Grinds via wrestling.",
      durability: "Rarely finished.",
      layoff: "Fought seven months ago.",
    },
    recentBouts: [
      { id: "bout-1", result: "win", opponentName: "Kai Asakura", eventName: "UFC 310", eventDate: "2024-12-07", method: "KO/TKO" },
    ],
    openFlags: [{ id: "flag-1", category: "weight_cut", summary: "Reported struggling to make weight." }],
    ...overrides,
  };
}

function fighter2Facts(overrides: Partial<ShadowPickFighterFacts> = {}): ShadowPickFighterFacts {
  return fighterFacts({
    fighterId: "f2",
    name: "Steve Erceg",
    eloRating: 1480.9,
    ratedFightCount: 5,
    reachCm: 175,
    heightCm: 170,
    ageYears: 29,
    sherdogWins: 9,
    sherdogLosses: 3,
    recentBouts: [{ id: "bout-2", result: "loss", opponentName: "Someone Else", eventName: null, eventDate: null, method: null }],
    openFlags: [],
    ...overrides,
  });
}

function fightFacts(overrides: Partial<ShadowPickFightFacts> = {}): ShadowPickFightFacts {
  return {
    fightId: "fight-1",
    fighter1: fighterFacts(),
    fighter2: fighter2Facts(),
    fighter1Price: -150,
    fighter2Price: 130,
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
      fighter2Elo: 1481,
      fighter1Reach: 170,
      fighter2Reach: 175,
      fighter1Height: 165,
      fighter2Height: 170,
      fighter1Age: 34,
      fighter2Age: 29,
      fighter1Wins: 13,
      fighter1Losses: 4,
      fighter2Wins: 9,
      fighter2Losses: 3,
      fighter1Price: -150,
      fighter2Price: 130,
    },
    deltas: { rumours: -0.05, elo: 0.04, size: -0.01, age: 0.02 },
    freeProbabilityFighter1: 0.58,
    citedBoutIds: ["bout-1", "bout-2"],
    citedFlagIds: ["flag-1"],
    reasoning: "Pantoja's recent form and Elo edge outweigh Erceg's reach.",
    ...overrides,
  };
}

describe("shadowPickClaimChecks", () => {
  it("keeps a claim whose restated numerics, citations, and deltas are all valid", () => {
    const result = verifyClaims([claim()], facts([fightFacts()]), shadowPickClaimChecks);
    expect(result.kept).toEqual([claim()]);
    expect(result.dropReasons).toEqual({});
  });

  it("drops a claim for a fightId that isn't on this card", () => {
    const c = claim({ fightId: "nonexistent" });
    const result = verifyClaims([c], facts([fightFacts()]), shadowPickClaimChecks);
    expect(result.kept).toEqual([]);
    expect(result.dropReasons).toEqual({ unknown_fight_id: 1 });
  });

  it("drops a claim that misstates fighter1's Elo (rounded) even by one point", () => {
    const c = claim({ restated: { ...claim().restated, fighter1Elo: 1551 } });
    const result = verifyClaims([c], facts([fightFacts()]), shadowPickClaimChecks);
    expect(result.kept).toEqual([]);
    expect(result.dropReasons).toEqual({ numeric_mismatch: 1 });
  });

  it("drops a claim that misstates a null field as a number", () => {
    const noReach = fightFacts({ fighter1: fighterFacts({ reachCm: null }) });
    const c = claim({ restated: { ...claim().restated, fighter1Reach: 170 } });
    const result = verifyClaims([c], facts([noReach]), shadowPickClaimChecks);
    expect(result.kept).toEqual([]);
    expect(result.dropReasons).toEqual({ numeric_mismatch: 1 });
  });

  it("drops a claim that misstates the market price", () => {
    const c = claim({ restated: { ...claim().restated, fighter2Price: 999 } });
    const result = verifyClaims([c], facts([fightFacts()]), shadowPickClaimChecks);
    expect(result.kept).toEqual([]);
    expect(result.dropReasons).toEqual({ numeric_mismatch: 1 });
  });

  it("keeps a claim on an unpriced fight when the restated prices are both null", () => {
    const unpriced = fightFacts({ fighter1Price: null, fighter2Price: null });
    const c = claim({ restated: { ...claim().restated, fighter1Price: null, fighter2Price: null } });
    const result = verifyClaims([c], facts([unpriced]), shadowPickClaimChecks);
    expect(result.kept).toEqual([c]);
  });

  it("drops a claim citing a bout id real for the OTHER fighter, not either fighter in this fight", () => {
    const c = claim({ citedBoutIds: ["bout-1", "bout-only-elsewhere"] });
    const result = verifyClaims([c], facts([fightFacts()]), shadowPickClaimChecks);
    expect(result.kept).toEqual([]);
    expect(result.dropReasons).toEqual({ fabricated_bout_id: 1 });
  });

  it("drops a claim citing a flag id that doesn't exist on either fighter", () => {
    const c = claim({ citedFlagIds: ["flag-fake"] });
    const result = verifyClaims([c], facts([fightFacts()]), shadowPickClaimChecks);
    expect(result.kept).toEqual([]);
    expect(result.dropReasons).toEqual({ fabricated_flag_id: 1 });
  });

  it("drops a claim whose rumours delta exceeds its own per-signal cap (0.12)", () => {
    const c = claim({ deltas: { ...claim().deltas, rumours: 0.13 } });
    const result = verifyClaims([c], facts([fightFacts()]), shadowPickClaimChecks);
    expect(result.kept).toEqual([]);
    expect(result.dropReasons).toEqual({ delta_over_signal_cap: 1 });
  });

  it("drops a claim whose elo delta exceeds its own per-signal cap (0.15)", () => {
    const c = claim({ deltas: { ...claim().deltas, elo: -0.16 } });
    const result = verifyClaims([c], facts([fightFacts()]), shadowPickClaimChecks);
    expect(result.dropReasons).toEqual({ delta_over_signal_cap: 1 });
  });

  it("drops a claim whose size delta exceeds its own per-signal cap (0.06)", () => {
    const c = claim({ deltas: { ...claim().deltas, size: 0.07 } });
    const result = verifyClaims([c], facts([fightFacts()]), shadowPickClaimChecks);
    expect(result.dropReasons).toEqual({ delta_over_signal_cap: 1 });
  });

  it("drops a claim whose age delta exceeds its own per-signal cap (0.04)", () => {
    const c = claim({ deltas: { ...claim().deltas, age: -0.05 } });
    const result = verifyClaims([c], facts([fightFacts()]), shadowPickClaimChecks);
    expect(result.dropReasons).toEqual({ delta_over_signal_cap: 1 });
  });

  it("keeps a claim whose individual deltas are each within cap but exactly AT the total cap (0.25)", () => {
    const c = claim({ deltas: { rumours: 0.12, elo: 0.1, size: 0.02, age: 0.01 } });
    const result = verifyClaims([c], facts([fightFacts()]), shadowPickClaimChecks);
    expect(result.kept).toEqual([c]);
  });

  it("drops a claim whose signals each stay within their own cap but sum over MAX_TOTAL_ADJUSTMENT (0.25)", () => {
    const c = claim({ deltas: { rumours: 0.12, elo: 0.11, size: 0.02, age: 0.01 } });
    const result = verifyClaims([c], facts([fightFacts()]), shadowPickClaimChecks);
    expect(result.kept).toEqual([]);
    expect(result.dropReasons).toEqual({ sum_over_max_adjustment: 1 });
  });

  it("drops a claim whose freeProbabilityFighter1 is not strictly inside (0, 1)", () => {
    const c = claim({ freeProbabilityFighter1: 1 });
    const result = verifyClaims([c], facts([fightFacts()]), shadowPickClaimChecks);
    expect(result.kept).toEqual([]);
    expect(result.dropReasons).toEqual({ probability_out_of_range: 1 });
  });

  it("drops a claim whose freeProbabilityFighter1 is exactly 0", () => {
    const c = claim({ freeProbabilityFighter1: 0 });
    const result = verifyClaims([c], facts([fightFacts()]), shadowPickClaimChecks);
    expect(result.dropReasons).toEqual({ probability_out_of_range: 1 });
  });
});
