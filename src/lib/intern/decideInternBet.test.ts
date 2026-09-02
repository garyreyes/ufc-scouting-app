import { describe, expect, it } from "vitest";
import {
  decideInternBet,
  EDGE_THRESHOLD,
  MAX_STAKE_UNITS,
  MIN_STAKE_UNITS,
} from "./decideInternBet";

const F1 = "f1";
const F2 = "f2";

describe("decideInternBet", () => {
  it("never bets when there's no price yet", () => {
    const decision = decideInternBet(F1, F2, F1, 0.6, 3, null);
    expect(decision.betFighterId).toBeNull();
    expect(decision.stakeUnits).toBeNull();
  });

  // PRD UC-3's own headline example: silence on an unbackable favourite
  // is the intern working, not failing. Decimal 1.0167 implies 98.4% --
  // an estimate that just matches the market has ~zero edge, well under
  // the threshold.
  it("declines to bet on a -6000 favourite when its own estimate just matches the market", () => {
    const decimalOdds = 1.0167;
    const impliedProbability = 1 / decimalOdds;
    const decision = decideInternBet(F1, F2, F1, impliedProbability, 5, {
      fighter1Price: decimalOdds,
      fighter2Price: 60,
    });
    expect(decision.betFighterId).toBeNull();
    expect(decision.stakeUnits).toBeNull();
    expect(decision.note).toContain("below");
  });

  it("bets the predicted fighter when their own edge clears the threshold", () => {
    const decision = decideInternBet(F1, F2, F1, 0.65, 3, {
      fighter1Price: 2.0,
      fighter2Price: 2.0,
    });
    expect(decision.betFighterId).toBe(F1);
    expect(decision.stakeUnits).toBeGreaterThanOrEqual(MIN_STAKE_UNITS);
  });

  // The actual point of checking both sides: a bet can back the fighter
  // the intern did NOT predict to win, same as a human's own bet can
  // (docs/PRD.md UC-2).
  it("can bet the NON-predicted fighter when their price gives them the better edge", () => {
    // f1 predicted at 55%, so f2's implied probability is 45%. At a
    // long enough price, f2's edge clears the threshold even though f1
    // is the pick.
    const decision = decideInternBet(F1, F2, F1, 0.55, 3, {
      fighter1Price: 1.5, // f1's own edge: 0.55*1.5-1 = -0.175, well under threshold
      fighter2Price: 3.0, // f2's edge: 0.45*3.0-1 = 0.35, clears easily
    });
    expect(decision.betFighterId).toBe(F2);
  });

  it("stake increases as edge increases, holding confidence fixed", () => {
    const small = decideInternBet(F1, F2, F1, 0.55, 3, { fighter1Price: 2.0, fighter2Price: 2.0 });
    const big = decideInternBet(F1, F2, F1, 0.75, 3, { fighter1Price: 2.0, fighter2Price: 2.0 });
    expect(big.stakeUnits!).toBeGreaterThan(small.stakeUnits!);
  });

  // The actual point of the fork the user confirmed: identical edge,
  // different confidence, must produce different stakes.
  it("stake increases as confidence increases, holding edge fixed", () => {
    const lowConfidence = decideInternBet(F1, F2, F1, 0.65, 1, {
      fighter1Price: 2.0,
      fighter2Price: 2.0,
    });
    const highConfidence = decideInternBet(F1, F2, F1, 0.65, 5, {
      fighter1Price: 2.0,
      fighter2Price: 2.0,
    });
    expect(highConfidence.stakeUnits!).toBeGreaterThan(lowConfidence.stakeUnits!);
  });

  it("never stakes below MIN_STAKE_UNITS on a qualifying bet, even at the lowest confidence", () => {
    const decision = decideInternBet(F1, F2, F1, 0.551, 1, {
      fighter1Price: 2.0,
      fighter2Price: 2.0,
    });
    expect(decision.betFighterId).not.toBeNull();
    expect(decision.stakeUnits!).toBeGreaterThanOrEqual(MIN_STAKE_UNITS);
  });

  it("never stakes above MAX_STAKE_UNITS, even at an extreme edge and top confidence", () => {
    const decision = decideInternBet(F1, F2, F1, 0.99, 5, {
      fighter1Price: 3.0,
      fighter2Price: 1.5,
    });
    expect(decision.stakeUnits!).toBeLessThanOrEqual(MAX_STAKE_UNITS);
  });

  it("is deterministic -- identical inputs always produce identical output", () => {
    const inputs = [F1, F2, F1, 0.65, 4, { fighter1Price: 2.0, fighter2Price: 2.0 }] as const;
    expect(decideInternBet(...inputs)).toEqual(decideInternBet(...inputs));
  });

  it("declines with a real, non-empty explanation, never a silent null with no reason", () => {
    const decision = decideInternBet(F1, F2, F1, 0.5, 3, { fighter1Price: 2.0, fighter2Price: 2.0 });
    expect(decision.note.length).toBeGreaterThan(0);
  });

  it("EDGE_THRESHOLD is a real, positive margin above zero, not exactly zero", () => {
    expect(EDGE_THRESHOLD).toBeGreaterThan(0);
  });
});
