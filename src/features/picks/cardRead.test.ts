import { describe, expect, it } from "vitest";
import { buildCardReadRows, type CardReadPick } from "./cardRead";

const F1 = { id: "f1", name: "Alpha" };
const F2 = { id: "f2", name: "Bravo" };

function fight(odds: { fighter1_price: number; fighter2_price: number } | null) {
  return { id: "fight-1", fighter1: F1, fighter2: F2, odds };
}

function pick(overrides: Partial<CardReadPick>): CardReadPick {
  return {
    predictedFighterId: "f1",
    estimatedProbability: 0.6,
    confidence: 3,
    predictedMethod: "DECISION",
    betFighterId: null,
    stakeUnits: null,
    ...overrides,
  };
}

describe("buildCardReadRows", () => {
  it("skips a fight with no pick", () => {
    expect(buildCardReadRows([fight(null)], new Map())).toEqual([]);
  });

  it("for a no-bet pick, the numbers describe the PICKED fighter", () => {
    const rows = buildCardReadRows(
      [fight({ fighter1_price: 1.5, fighter2_price: 2.7 })],
      new Map([["fight-1", pick({ betFighterId: null })]]),
    );
    expect(rows[0].pickName).toBe("Alpha");
    expect(rows[0].betName).toBeNull();
    expect(rows[0].focusName).toBe("Alpha");
    expect(rows[0].pickerProb).toBeCloseTo(0.6, 10);
  });

  it("carries confidence through", () => {
    const rows = buildCardReadRows(
      [fight(null)],
      new Map([["fight-1", pick({ confidence: 5 })]]),
    );
    expect(rows[0].confidence).toBe(5);
  });

  it("for a bet on the SAME fighter as the pick, focus stays on that fighter", () => {
    const rows = buildCardReadRows(
      [fight({ fighter1_price: 1.5, fighter2_price: 2.7 })],
      new Map([["fight-1", pick({ betFighterId: "f1", stakeUnits: 1.5 })]]),
    );
    expect(rows[0].betName).toBe("Alpha");
    expect(rows[0].stakeUnits).toBe(1.5);
    expect(rows[0].pickerProb).toBeCloseTo(0.6, 10);
  });

  it("for a bet on the OTHER fighter, the numbers flip to the bet fighter", () => {
    // The probabilityForFighter case: the pick is P(f1)=0.61, so a bet on
    // f2 must read as P(f2)=0.39, its de-vigged market price, and edge
    // computed against f2's odds -- not f1's numbers. This is the shape
    // both the intern (bets the underdog often) and the owner produce
    // when they pick one fighter and back the other.
    const rows = buildCardReadRows(
      [fight({ fighter1_price: 1.28, fighter2_price: 3.87 })],
      new Map([
        [
          "fight-1",
          pick({ predictedFighterId: "f1", estimatedProbability: 0.61, betFighterId: "f2", stakeUnits: 1.8 }),
        ],
      ]),
    );
    const row = rows[0];
    expect(row.pickName).toBe("Alpha");
    expect(row.betName).toBe("Bravo");
    expect(row.focusName).toBe("Bravo");
    expect(row.pickerProb).toBeCloseTo(0.39, 10);
    const expectedMarket = 1 / 3.87 / (1 / 1.28 + 1 / 3.87);
    expect(row.marketProb).toBeCloseTo(expectedMarket, 10);
    expect(row.edgePct).toBeCloseTo(0.39 * 3.87 - 1, 10);
  });

  it("leaves market and edge null for an unpriced fight but still reports the picker's probability", () => {
    const rows = buildCardReadRows(
      [fight(null)],
      new Map([["fight-1", pick({ estimatedProbability: 0.55 })]]),
    );
    expect(rows[0].marketProb).toBeNull();
    expect(rows[0].edgePct).toBeNull();
    expect(rows[0].pickerProb).toBeCloseTo(0.55, 10);
  });

  it("carries the predicted method through, including null", () => {
    const withMethod = buildCardReadRows(
      [fight(null)],
      new Map([["fight-1", pick({ predictedMethod: "KO_TKO" })]]),
    );
    expect(withMethod[0].method).toBe("KO_TKO");

    const noMethod = buildCardReadRows(
      [fight(null)],
      new Map([["fight-1", pick({ predictedMethod: null })]]),
    );
    expect(noMethod[0].method).toBeNull();
  });
});
