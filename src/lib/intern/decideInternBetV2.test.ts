import { describe, expect, it } from "vitest";
import { decideInternBetV2, V2_MAX_STAKE_UNITS, V2_MIN_STAKE_UNITS } from "./decideInternBetV2";

const F1 = "fighter-1";
const F2 = "fighter-2";

// 1.5 / 2.8 de-vigs to 0.65116 / 0.34884 (overround 1.02381).
const FAV_VS_DOG = { fighter1Price: 1.5, fighter2Price: 2.8 };

describe("decideInternBetV2", () => {
  it("never bets without a price", () => {
    const decision = decideInternBetV2(F1, F2, F1, 0.6, 3, null);
    expect(decision.betFighterId).toBeNull();
    expect(decision.stakeUnits).toBeNull();
  });

  it("bets the underdog when both gates clear, sized by quarter-Kelly on 100u", () => {
    // P(F2) = 0.40 vs market 0.34884: +5.1 pts, EV = 0.4 x 2.8 - 1 = +12%.
    // Kelly = 0.12 / 1.8 = 0.0667; quarter on 100u = 1.6667 -> 1.67u.
    const decision = decideInternBetV2(F1, F2, F1, 0.6, 2, FAV_VS_DOG);
    expect(decision.betFighterId).toBe(F2);
    expect(decision.stakeUnits).toBe(1.67);
  });

  it("never bets a confidence-1 read (a coin flip is not a view)", () => {
    const decision = decideInternBetV2(F1, F2, F1, 0.6, 1, FAV_VS_DOG);
    expect(decision.betFighterId).toBeNull();
  });

  it("never bets a price above 3.50, however big the edge looks", () => {
    // 1.25 / 4.2: market P(F2) = 0.2294. P(F2) = 0.30 -> +7.1 pts, EV +26%.
    const decision = decideInternBetV2(F1, F2, F1, 0.7, 3, { fighter1Price: 1.25, fighter2Price: 4.2 });
    expect(decision.betFighterId).toBeNull();
  });

  it("declines when the probability edge clears but EV does not", () => {
    // P(F1) = 0.685 vs 0.65116: +3.4 pts, but EV = 0.685 x 1.5 - 1 = +2.75%.
    const decision = decideInternBetV2(F1, F2, F1, 0.685, 3, FAV_VS_DOG);
    expect(decision.betFighterId).toBeNull();
  });

  it("declines when EV clears but the probability edge does not", () => {
    // Vig-free 2.0 / 2.0: P = 0.52 is only +2 pts, though EV is +4%.
    const decision = decideInternBetV2(F1, F2, F1, 0.52, 3, { fighter1Price: 2.0, fighter2Price: 2.0 });
    expect(decision.betFighterId).toBeNull();
  });

  it("bets a favourite when it clears both gates, capped at the max stake", () => {
    // P(F1) = 0.70: +4.9 pts, EV +5%. Kelly 0.05 / 0.5 = 0.1 -> 2.5u -> capped 2u.
    const decision = decideInternBetV2(F1, F2, F1, 0.7, 3, FAV_VS_DOG);
    expect(decision.betFighterId).toBe(F1);
    expect(decision.stakeUnits).toBe(V2_MAX_STAKE_UNITS);
  });

  it("sizes a mid-priced underdog below the cap: 3.4 dog at P = 0.32 -> 0.92u", () => {
    // 3.4 / 1.35: market P(F1) = 0.28421. EV = 0.32 x 3.4 - 1 = 0.088.
    // Kelly 0.088 / 2.4 = 0.03667 -> quarter on 100u = 0.9167 -> 0.92u.
    const decision = decideInternBetV2(F1, F2, F2, 0.68, 3, { fighter1Price: 3.4, fighter2Price: 1.35 });
    expect(decision.betFighterId).toBe(F1);
    expect(decision.stakeUnits).toBe(0.92);
  });

  it("every qualifying stake stays within [min, max]", () => {
    const decision = decideInternBetV2(F1, F2, F1, 0.6, 5, FAV_VS_DOG);
    expect(decision.stakeUnits!).toBeGreaterThanOrEqual(V2_MIN_STAKE_UNITS);
    expect(decision.stakeUnits!).toBeLessThanOrEqual(V2_MAX_STAKE_UNITS);
  });

  it("is deterministic", () => {
    const a = decideInternBetV2(F1, F2, F1, 0.6, 2, FAV_VS_DOG);
    const b = decideInternBetV2(F1, F2, F1, 0.6, 2, FAV_VS_DOG);
    expect(a).toEqual(b);
  });
});
