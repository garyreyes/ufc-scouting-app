import { describe, expect, it } from "vitest";
import { buildBettingHeadToHead } from "./buildBettingHeadToHead";
import type { SettledInternPick, SettledUserSlip } from "./buildBettingHeadToHead";

const internPicks: SettledInternPick[] = [
  { fightId: "fight-bukauskas", pnlUnits: -1, stakeUnits: 1, pickCorrect: false },
  { fightId: "fight-hooker", pnlUnits: 1.5, stakeUnits: 1, pickCorrect: true },
];

describe("buildBettingHeadToHead", () => {
  it("pairs a single-leg MONEYLINE slip with INTERN's pick on the same fight", () => {
    const slips: SettledUserSlip[] = [
      {
        status: "won",
        pnlPhp: 285,
        pnlUnits: 2.85,
        stakePhp: 100,
        stakeUnits: 1,
        legs: [{ fightId: "fight-bukauskas", market: "MONEYLINE" }],
      },
    ];
    const pairs = buildBettingHeadToHead(slips, internPicks);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].fightId).toBe("fight-bukauskas");
    expect(pairs[0].owner.pnlPhp).toBe(285);
    expect(pairs[0].intern.pnlUnits).toBe(-1);
  });

  it("excludes a multi-leg slip even when one of its legs is a MONEYLINE fight INTERN also picked", () => {
    const slips: SettledUserSlip[] = [
      {
        status: "lost",
        pnlPhp: -100,
        pnlUnits: -1,
        stakePhp: 100,
        stakeUnits: 1,
        legs: [
          { fightId: "fight-hooker", market: "MONEYLINE" },
          { fightId: "fight-other", market: "METHOD_FIGHTER" },
        ],
      },
    ];
    expect(buildBettingHeadToHead(slips, internPicks)).toHaveLength(0);
  });

  it("excludes a single-leg slip on a non-MONEYLINE market", () => {
    const slips: SettledUserSlip[] = [
      {
        status: "lost",
        pnlPhp: -100,
        pnlUnits: -1,
        stakePhp: 100,
        stakeUnits: 1,
        legs: [{ fightId: "fight-hooker", market: "METHOD_FIGHTER" }],
      },
    ];
    expect(buildBettingHeadToHead(slips, internPicks)).toHaveLength(0);
  });

  it("excludes a fight INTERN never picked", () => {
    const slips: SettledUserSlip[] = [
      {
        status: "won",
        pnlPhp: 100,
        pnlUnits: 1,
        stakePhp: 100,
        stakeUnits: 1,
        legs: [{ fightId: "fight-unpriced-by-intern", market: "MONEYLINE" }],
      },
    ];
    expect(buildBettingHeadToHead(slips, internPicks)).toHaveLength(0);
  });

  it("excludes a leg with no fightId (an external/non-UFC leg)", () => {
    const slips: SettledUserSlip[] = [
      {
        status: "lost",
        pnlPhp: -100,
        pnlUnits: -1,
        stakePhp: 100,
        stakeUnits: 1,
        legs: [{ fightId: null, market: "MONEYLINE" }],
      },
    ];
    expect(buildBettingHeadToHead(slips, internPicks)).toHaveLength(0);
  });
});
