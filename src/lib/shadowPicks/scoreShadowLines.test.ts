import { describe, expect, it } from "vitest";
import { scoreShadowLines } from "./scoreShadowLines";
import type { ScoredShadowRow, ShadowScoredFight } from "./scoreShadowLines";

const FIGHT_1 = "fight-1";
const FIGHT_2 = "fight-2";
const FIGHTER_A = "fighter-a";
const FIGHTER_B = "fighter-b";

function fight(overrides: Partial<ShadowScoredFight>): ShadowScoredFight {
  return {
    fighter1Id: FIGHTER_A,
    fighter2Id: FIGHTER_B,
    outcome: { kind: "decided", winnerId: FIGHTER_A },
    odds: { fighter1_price: 2.0, fighter2_price: 2.0 },
    ...overrides,
  };
}

function row(overrides: Partial<ScoredShadowRow>): ScoredShadowRow {
  return {
    fightId: FIGHT_1,
    line: "LLM_ASSISTED",
    predictedFighterId: FIGHTER_A,
    probability: 0.65,
    confidence: 3,
    ...overrides,
  };
}

describe("scoreShadowLines", () => {
  it("scores accuracy and Brier for LLM_ASSISTED the same way any calibrated line is scored", () => {
    const fightsById = new Map([[FIGHT_1, fight({})]]);
    const rows = [row({ line: "LLM_ASSISTED", probability: 0.65 })];

    const { llmAssisted } = scoreShadowLines(rows, fightsById);

    expect(llmAssisted.accuracy).toEqual({ correct: 1, total: 1, accuracyPct: 1 });
    expect(llmAssisted.brier.n).toBe(1);
    expect(llmAssisted.brier.score).toBeCloseTo((1 - 0.65) ** 2, 10);
  });

  it("scores an incorrect call correctly (a wrong pick is not the same as a void)", () => {
    const fightsById = new Map([[FIGHT_1, fight({ outcome: { kind: "decided", winnerId: FIGHTER_B } })]]);
    const rows = [row({ probability: 0.65 })];

    const { llmAssisted } = scoreShadowLines(rows, fightsById);

    expect(llmAssisted.accuracy).toEqual({ correct: 0, total: 1, accuracyPct: 0 });
    expect(llmAssisted.brier.score).toBeCloseTo(0.65 ** 2, 10);
  });

  it("excludes a void fight from accuracy and Brier, never scoring it as wrong", () => {
    const fightsById = new Map([[FIGHT_1, fight({ outcome: { kind: "void" } })]]);
    const rows = [row({})];

    const { llmAssisted } = scoreShadowLines(rows, fightsById);

    expect(llmAssisted.accuracy).toEqual({ correct: 0, total: 0, accuracyPct: null });
    expect(llmAssisted.brier).toEqual({ score: null, n: 0 });
  });

  it("computes LLM_ASSISTED units via the real decideInternBet/scoreBetPnl functions, not a flat synthetic bet", () => {
    // Edge clears the 5% threshold at even money against a 65% estimate --
    // decideInternBet.test.ts's own shape for "bets the predicted fighter".
    const fightsById = new Map([[FIGHT_1, fight({ odds: { fighter1_price: 2.0, fighter2_price: 2.0 } })]]);
    const rows = [row({ probability: 0.65, confidence: 3 })];

    const { llmAssisted } = scoreShadowLines(rows, fightsById);

    expect(llmAssisted.units).not.toBeNull();
    expect(llmAssisted.units!.betsPlaced).toBe(1);
    expect(llmAssisted.units!.betsWon).toBe(1);
    expect(llmAssisted.units!.netUnits).toBeGreaterThan(0);
  });

  it("LLM_ASSISTED places no bet when the edge never clears the threshold, and units still report zero, not null", () => {
    // 51% estimate against even money is a near-zero edge, well under
    // decideInternBet's EDGE_THRESHOLD (0.05).
    const fightsById = new Map([[FIGHT_1, fight({})]]);
    const rows = [row({ probability: 0.51, confidence: 3 })];

    const { llmAssisted } = scoreShadowLines(rows, fightsById);

    expect(llmAssisted.units).toEqual({ netUnits: 0, betsPlaced: 0, betsWon: 0, betsLost: 0, betsVoided: 0 });
  });

  it("LLM_ASSISTED never bets on an unpriced fight, since decideInternBet requires real odds", () => {
    const fightsById = new Map([[FIGHT_1, fight({ odds: null })]]);
    const rows = [row({ probability: 0.9, confidence: 5 })];

    const { llmAssisted } = scoreShadowLines(rows, fightsById);

    expect(llmAssisted.units!.betsPlaced).toBe(0);
  });

  it("LLM_ONLY never produces a units line -- it has no confidence, so decideInternBet structurally can't run", () => {
    const fightsById = new Map([[FIGHT_1, fight({})]]);
    const rows = [row({ line: "LLM_ONLY", confidence: null, probability: 0.9 })];

    const { llmOnly } = scoreShadowLines(rows, fightsById);

    expect(llmOnly.units).toBeNull();
    // Accuracy and Brier are still scored -- only units is structurally absent.
    expect(llmOnly.accuracy.total).toBe(1);
  });

  it("keeps LLM_ASSISTED and LLM_ONLY populations independent when only one line has a row for a fight", () => {
    const fightsById = new Map([
      [FIGHT_1, fight({})],
      [FIGHT_2, fight({})],
    ]);
    const rows = [
      row({ fightId: FIGHT_1, line: "LLM_ASSISTED" }),
      row({ fightId: FIGHT_2, line: "LLM_ONLY", confidence: null }),
    ];

    const { llmAssisted, llmOnly } = scoreShadowLines(rows, fightsById);

    expect(llmAssisted.accuracy.total).toBe(1);
    expect(llmOnly.accuracy.total).toBe(1);
  });

  it("returns empty/null results on no input, never NaN or a crash", () => {
    const { llmAssisted, llmOnly } = scoreShadowLines([], new Map());
    expect(llmAssisted.accuracy).toEqual({ correct: 0, total: 0, accuracyPct: null });
    expect(llmAssisted.units).toEqual({ netUnits: 0, betsPlaced: 0, betsWon: 0, betsLost: 0, betsVoided: 0 });
    expect(llmOnly.units).toBeNull();
  });
});
