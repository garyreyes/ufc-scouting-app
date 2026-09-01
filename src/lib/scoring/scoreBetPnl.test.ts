import { describe, expect, it } from "vitest";
import { scoreBetPnl } from "./scoreBetPnl";

const FIGHTER_A = "fighter-a";
const FIGHTER_B = "fighter-b";

describe("scoreBetPnl", () => {
  it("is null when no bet was placed -- 'no stake required' (docs/PRD.md), distinct from a void's known zero", () => {
    expect(scoreBetPnl(null, null, 1.5, { kind: "decided", winnerId: FIGHTER_A })).toBeNull();
  });

  it("is null if only one of betFighterId/stakeUnits is set -- the DB's own check constraint (0019_picks.sql) guarantees this never happens for a real row, but the function must fail safe rather than compute against half a bet", () => {
    expect(scoreBetPnl(FIGHTER_A, null, 1.5, { kind: "decided", winnerId: FIGHTER_A })).toBeNull();
    expect(scoreBetPnl(null, 10, 1.5, { kind: "decided", winnerId: FIGHTER_A })).toBeNull();
  });

  it("a favourite bet that wins returns stake * (price - 1) -- known moneyline example", () => {
    // decimal 1.20 favourite, 10 units staked, wins: profit = 10*0.20 = 2.
    expect(scoreBetPnl(FIGHTER_A, 10, 1.2, { kind: "decided", winnerId: FIGHTER_A })).toBeCloseTo(2, 2);
  });

  it("an underdog bet that wins returns the full decimal payout -- known moneyline example", () => {
    // decimal 3.5 underdog, 10 units staked, wins: profit = 10*2.5 = 25.
    expect(scoreBetPnl(FIGHTER_A, 10, 3.5, { kind: "decided", winnerId: FIGHTER_A })).toBeCloseTo(25, 2);
  });

  it("a losing bet returns exactly -stake, regardless of price", () => {
    expect(scoreBetPnl(FIGHTER_A, 10, 3.5, { kind: "decided", winnerId: FIGHTER_B })).toBe(-10);
  });

  it("a void outcome returns exactly 0 -- the stake back, 'not counted as a loss' (docs/PRD.md), distinct from no-bet's null", () => {
    expect(scoreBetPnl(FIGHTER_A, 10, 3.5, { kind: "void" })).toBe(0);
  });
});
