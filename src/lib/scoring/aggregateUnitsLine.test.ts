import { describe, expect, it } from "vitest";
import { aggregateUnitsLine } from "./aggregateUnitsLine";

// The units board's whole point (docs/PRD.md UC-4: "did I find mispriced
// fights?") rests on this reduction being exactly right -- a wrong sum or
// a void miscounted as a loss would misstate the one number the entire
// board exists to show.
describe("aggregateUnitsLine", () => {
  it("returns all zeros for no bets", () => {
    expect(aggregateUnitsLine([])).toEqual({
      netUnits: 0,
      betsPlaced: 0,
      betsWon: 0,
      betsLost: 0,
      betsVoided: 0,
    });
  });

  it("sums net units and classifies each result correctly", () => {
    const result = aggregateUnitsLine([
      { stakeUnits: 1, pnlUnits: 2.5 }, // win
      { stakeUnits: 2, pnlUnits: -2 }, // loss
      { stakeUnits: 1, pnlUnits: 0 }, // void
      { stakeUnits: 1.5, pnlUnits: 1.2 }, // win
    ]);
    expect(result.netUnits).toBeCloseTo(1.7, 5);
    expect(result.betsPlaced).toBe(4);
    expect(result.betsWon).toBe(2);
    expect(result.betsLost).toBe(1);
    expect(result.betsVoided).toBe(1);
  });

  it("a void bet counts toward betsPlaced but not won or lost", () => {
    const result = aggregateUnitsLine([{ stakeUnits: 1, pnlUnits: 0 }]);
    expect(result.betsPlaced).toBe(1);
    expect(result.betsWon).toBe(0);
    expect(result.betsLost).toBe(0);
    expect(result.betsVoided).toBe(1);
    expect(result.netUnits).toBe(0);
  });
});
