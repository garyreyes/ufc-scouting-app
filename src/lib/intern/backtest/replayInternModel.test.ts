import { describe, expect, it } from "vitest";
import { INTERN_V1, INTERN_V2 } from "../internModel";
import { minRatedFromReasoning, recoverV1Delta, replayInternModel, type BacktestFight } from "./replayInternModel";

// 1.5 / 2.8 de-vigs to P(f1) = 0.651163.
const base: BacktestFight = {
  fightId: "a",
  fighter1Id: "f1",
  fighter2Id: "f2",
  fighter1Price: 1.5,
  fighter2Price: 2.8,
  v1Delta: 0,
  minRatedFightCount: 10,
  winnerId: "f1",
};

describe("recoverV1Delta", () => {
  it("prefers the stored clampedDelta when present", () => {
    expect(recoverV1Delta(-0.12, 0.9, true, 1.5, 2.8)).toBe(-0.12);
  });

  it("inverts the stored probability against the de-vigged anchor", () => {
    // Stored 0.75 on f1: 0.75 - 0.651163 = 0.098837.
    expect(recoverV1Delta(null, 0.75, true, 1.5, 2.8)).toBeCloseTo(0.098837, 5);
    // Stored 0.6 on f2 => P(f1) = 0.4: 0.4 - 0.651163 = -0.251163.
    expect(recoverV1Delta(null, 0.6, false, 1.5, 2.8)).toBeCloseTo(-0.251163, 5);
  });
});

describe("minRatedFromReasoning", () => {
  it("reads the smaller rated-fight count out of the Elo note", () => {
    expect(minRatedFromReasoning("Elo: A 1520 (10 rated), B 1480 (3 rated). Final")).toBe(3);
  });

  it("returns 0 when the note is missing (the thinnest-sample assumption)", () => {
    expect(minRatedFromReasoning(null)).toBe(0);
  });
});

describe("replayInternModel", () => {
  it("with zero delta, the model IS the market: Brier = (1 - 0.651163)^2", () => {
    const m = replayInternModel([base], INTERN_V2);
    expect(m.fights).toBe(1);
    expect(m.brier).toBeCloseTo((1 - 0.651163) ** 2, 5);
    expect(m.logLoss).toBeCloseTo(-Math.log(0.651163), 5);
    expect(m.correct).toBe(1);
    expect(m.bets).toBe(0);
  });

  it("a large v1 delta toward the dog flips v1's pick but not v2's", () => {
    const fight = { ...base, v1Delta: -0.25 };
    expect(replayInternModel([fight], INTERN_V1).correct).toBe(0);
    expect(replayInternModel([fight], INTERN_V2).correct).toBe(1);
  });

  it("scores a qualifying v2 underdog bet: -0.2 delta => P(f2) = 0.418837, 2.8 dog, loses its stake", () => {
    // Pick f1 at 0.581163 (conf 2); dog: +7 pts over market, EV +17.3%.
    // Quarter-Kelly: 25 x 0.172744 / 1.8 = 2.399 -> capped at 2u.
    const m = replayInternModel([{ ...base, v1Delta: -0.2 }], INTERN_V2);
    expect(m.bets).toBe(1);
    expect(m.staked).toBe(2);
    expect(m.pnl).toBe(-2);
    expect(m.dogBets).toBe(1);
    expect(m.roi).toBe(-1);
  });

  it("a void fight is excluded from Brier and returns any stake", () => {
    const m = replayInternModel([{ ...base, v1Delta: -0.2, winnerId: null }], INTERN_V2);
    expect(m.fights).toBe(0);
    expect(m.bets).toBe(1);
    expect(m.pnl).toBe(0);
  });
});
