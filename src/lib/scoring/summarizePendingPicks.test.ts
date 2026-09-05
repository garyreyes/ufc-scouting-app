import { describe, expect, it } from "vitest";
import { summarizePendingPicks } from "./summarizePendingPicks";
import type { PendingPickInput } from "./summarizePendingPicks";

function pick(overrides: Partial<PendingPickInput>): PendingPickInput {
  return {
    author: "INTERN",
    settledAt: null,
    betFighterId: null,
    stakeUnits: null,
    ...overrides,
  };
}

describe("summarizePendingPicks", () => {
  it("counts nothing for an empty list", () => {
    expect(summarizePendingPicks([])).toEqual({
      me: { picks: 0, bets: 0, unitsAtRisk: 0 },
      intern: { picks: 0, bets: 0, unitsAtRisk: 0 },
    });
  });

  it("ignores already-settled picks -- pending means not yet scored", () => {
    const result = summarizePendingPicks([
      pick({ author: "INTERN", settledAt: "2026-09-01T00:00:00Z" }),
      pick({ author: "USER", settledAt: "2026-09-01T00:00:00Z", betFighterId: "f1", stakeUnits: 2 }),
    ]);
    expect(result.intern.picks).toBe(0);
    expect(result.me.picks).toBe(0);
    expect(result.me.unitsAtRisk).toBe(0);
  });

  it("splits pending picks by author", () => {
    const result = summarizePendingPicks([
      pick({ author: "INTERN" }),
      pick({ author: "INTERN" }),
      pick({ author: "USER" }),
    ]);
    expect(result.intern.picks).toBe(2);
    expect(result.me.picks).toBe(1);
  });

  it("counts a bet only when a fighter was actually backed, and sums the stake", () => {
    const result = summarizePendingPicks([
      pick({ author: "INTERN", betFighterId: "f1", stakeUnits: 1.4 }),
      pick({ author: "INTERN", betFighterId: "f2", stakeUnits: 0.6 }),
      pick({ author: "INTERN", betFighterId: null, stakeUnits: null }),
    ]);
    expect(result.intern.picks).toBe(3);
    expect(result.intern.bets).toBe(2);
    expect(result.intern.unitsAtRisk).toBeCloseTo(2.0, 5);
  });

  it("coerces a numeric stake that arrives as a string (postgREST numeric columns)", () => {
    // stake_units is numeric(6,2); the client can hand it back as "1.40".
    const result = summarizePendingPicks([
      pick({ author: "USER", betFighterId: "f1", stakeUnits: "1.40" as unknown as number }),
      pick({ author: "USER", betFighterId: "f2", stakeUnits: "0.75" as unknown as number }),
    ]);
    expect(result.me.unitsAtRisk).toBeCloseTo(2.15, 5);
  });

  it("treats an unknown author as neither -- only USER and INTERN are real pick authors", () => {
    const result = summarizePendingPicks([pick({ author: "SOMETHING_ELSE" })]);
    expect(result).toEqual({
      me: { picks: 0, bets: 0, unitsAtRisk: 0 },
      intern: { picks: 0, bets: 0, unitsAtRisk: 0 },
    });
  });
});
