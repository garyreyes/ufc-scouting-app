import { describe, expect, it } from "vitest";
import { decideInternPick } from "./decideInternPick";
import type { InternFlag, InternPickInput } from "./types";

// N5: decideInternPick's refactor only restructures its already-computed
// deltas into a new `signals` field -- it must change NOTHING about the
// number itself (ARCHITECTURE.md item #2, correctness-critical). This is
// the gate: a fixture corpus wide enough to exercise every signal alone,
// every signal in combination, and the combined-cap clamp, snapshotted on
// the fields that must stay bit-identical across the refactor. `signals`
// is deliberately excluded from the snapshot -- it is the new field the
// refactor is adding, not something it must preserve.
const baseFighter1 = {
  id: "f1",
  name: "Alexandre Pantoja",
  eloRating: 1500,
  ratedFightCount: 10,
  reachCm: null,
  heightCm: null,
  ageYears: null,
};
const baseFighter2 = {
  id: "f2",
  name: "Joshua Van",
  eloRating: 1500,
  ratedFightCount: 10,
  reachCm: null,
  heightCm: null,
  ageYears: null,
};

function flag(fighterId: string, corroborationCount = 1): InternFlag {
  return { fighterId, category: "weight_cut", corroborationCount };
}

const fixtures: Record<string, InternPickInput> = {
  noOddsNoSignals: {
    fighter1: baseFighter1,
    fighter2: baseFighter2,
    odds: null,
    flags: [],
  },
  pricedNoSignals: {
    fighter1: baseFighter1,
    fighter2: baseFighter2,
    odds: { fighter1Price: 1.5, fighter2Price: 2.5 },
    flags: [],
  },
  heavyFavouriteExtremeOdds: {
    fighter1: baseFighter1,
    fighter2: baseFighter2,
    odds: { fighter1Price: 1.01, fighter2Price: 25 },
    flags: [flag("f2", 99)],
  },
  rumourFlagOnF1Only: {
    fighter1: baseFighter1,
    fighter2: baseFighter2,
    odds: { fighter1Price: 1.5, fighter2Price: 2.5 },
    flags: [flag("f1", 2)],
  },
  rumourFlagsBothSidesEqual: {
    fighter1: baseFighter1,
    fighter2: baseFighter2,
    odds: { fighter1Price: 1.5, fighter2Price: 2.5 },
    flags: [flag("f1", 2), flag("f2", 2)],
  },
  eloEdgeToF1: {
    fighter1: { ...baseFighter1, eloRating: 1700 },
    fighter2: baseFighter2,
    odds: { fighter1Price: 1.5, fighter2Price: 2.5 },
    flags: [],
  },
  eloEdgeToF2ThinSample: {
    fighter1: { ...baseFighter1, eloRating: 1300 },
    fighter2: { ...baseFighter2, ratedFightCount: 1 },
    odds: { fighter1Price: 1.9, fighter2Price: 1.95 },
    flags: [],
  },
  sizeEdgeToF1: {
    fighter1: { ...baseFighter1, reachCm: 190, heightCm: 180 },
    fighter2: { ...baseFighter2, reachCm: 175, heightCm: 170 },
    odds: { fighter1Price: 1.5, fighter2Price: 2.5 },
    flags: [],
  },
  ageEdgeNoOdds: {
    fighter1: { ...baseFighter1, ageYears: 29 },
    fighter2: { ...baseFighter2, ageYears: 38 },
    odds: null,
    flags: [],
  },
  agePrimeNoEdge: {
    fighter1: { ...baseFighter1, ageYears: 30 },
    fighter2: { ...baseFighter2, ageYears: 31 },
    odds: { fighter1Price: 2.0, fighter2Price: 2.0 },
    flags: [],
  },
  allSignalsAgreeUnclamped: {
    fighter1: { ...baseFighter1, eloRating: 1600, reachCm: 185, ageYears: 29 },
    fighter2: { ...baseFighter2, reachCm: 178, ageYears: 34 },
    odds: { fighter1Price: 1.8, fighter2Price: 2.0 },
    flags: [flag("f2", 2)],
  },
  allSignalsAgreeClamped: {
    fighter1: { ...baseFighter1, eloRating: 2000, reachCm: 200, ageYears: 29 },
    fighter2: { ...baseFighter2, eloRating: 1500, reachCm: 170, ageYears: 45 },
    odds: null,
    flags: [flag("f2", 3), flag("f2", 3)],
  },
  signalsConflict: {
    fighter1: { ...baseFighter1, eloRating: 1000, ageYears: 40 },
    fighter2: { ...baseFighter2, eloRating: 1500, ageYears: 27 },
    odds: { fighter1Price: 1.05, fighter2Price: 15 },
    flags: [flag("f2", 3)],
  },
  favouriteFlippedByFlags: {
    fighter1: baseFighter1,
    fighter2: baseFighter2,
    odds: { fighter1Price: 1.9, fighter2Price: 1.95 },
    flags: [flag("f1", 3), flag("f1", 3)],
  },
};

describe("decideInternPick characterization (N5 refactor gate)", () => {
  for (const [name, input] of Object.entries(fixtures)) {
    it(`stays bit-identical on: ${name}`, () => {
      const decision = decideInternPick(input);
      expect({
        predictedFighterId: decision.predictedFighterId,
        estimatedProbability: decision.estimatedProbability,
        confidence: decision.confidence,
        reasoning: decision.reasoning,
        marketAnchored: decision.marketAnchored,
      }).toMatchSnapshot();
    });
  }
});
