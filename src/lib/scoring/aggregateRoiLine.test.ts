import { describe, expect, it } from "vitest";
import { aggregateRoiLine } from "./aggregateRoiLine";

describe("aggregateRoiLine", () => {
  it("returns zeros and a null ROI for no slips", () => {
    expect(aggregateRoiLine([])).toEqual({
      stakedPhp: 0,
      netPhp: 0,
      netUnits: 0,
      roiPct: null,
      betsPlaced: 0,
      betsWon: 0,
      betsLost: 0,
      betsVoided: 0,
    });
  });

  it("sums stake/net PHP and units, and computes ROI% off staked PHP", () => {
    const result = aggregateRoiLine([
      { stakePhp: 100, pnlPhp: 150, stakeUnits: 1, pnlUnits: 1.5 }, // win
      { stakePhp: 200, pnlPhp: -200, stakeUnits: 2, pnlUnits: -2 }, // loss
      { stakePhp: 100, pnlPhp: 0, stakeUnits: 1, pnlUnits: 0 }, // void
    ]);
    expect(result.stakedPhp).toBe(400);
    expect(result.netPhp).toBe(-50);
    expect(result.netUnits).toBeCloseTo(-0.5, 5);
    expect(result.roiPct).toBeCloseTo(-12.5, 5);
    expect(result.betsPlaced).toBe(3);
    expect(result.betsWon).toBe(1);
    expect(result.betsLost).toBe(1);
    expect(result.betsVoided).toBe(1);
  });

  it("a void slip (pnlPhp 0) counts toward betsPlaced but not won or lost", () => {
    const result = aggregateRoiLine([{ stakePhp: 100, pnlPhp: 0, stakeUnits: 1, pnlUnits: 0 }]);
    expect(result.betsWon).toBe(0);
    expect(result.betsLost).toBe(0);
    expect(result.betsVoided).toBe(1);
    expect(result.roiPct).toBe(0);
  });
});
