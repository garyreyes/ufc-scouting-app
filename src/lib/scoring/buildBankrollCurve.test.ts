import { describe, expect, it } from "vitest";
import { buildBankrollCurve } from "./buildBankrollCurve";

describe("buildBankrollCurve", () => {
  it("returns an empty curve for no ledger rows", () => {
    expect(buildBankrollCurve([])).toEqual([]);
  });

  it("accumulates the running balance in order, deposits and withdrawals both signed", () => {
    const curve = buildBankrollCurve([
      { occurredAt: "2026-08-01T00:00:00Z", amountPhp: 10000 }, // opening deposit
      { occurredAt: "2026-08-05T00:00:00Z", amountPhp: -150 }, // a loss
      { occurredAt: "2026-08-10T00:00:00Z", amountPhp: 447.55 }, // a win
      { occurredAt: "2026-08-15T00:00:00Z", amountPhp: -2000 }, // a withdrawal
    ]);
    expect(curve.map((p) => p.balancePhp)).toEqual([10000, 9850, 10297.55, 8297.55]);
    expect(curve[0].occurredAt).toBe("2026-08-01T00:00:00Z");
  });

  it("never lets balance and net movement drift apart -- final balance equals the sum of all amounts", () => {
    const entries = [
      { occurredAt: "2026-08-01T00:00:00Z", amountPhp: 10000 },
      { occurredAt: "2026-08-02T00:00:00Z", amountPhp: -500.25 },
      { occurredAt: "2026-08-03T00:00:00Z", amountPhp: 300.1 },
    ];
    const curve = buildBankrollCurve(entries);
    const expectedTotal = entries.reduce((sum, e) => sum + e.amountPhp, 0);
    expect(curve[curve.length - 1].balancePhp).toBeCloseTo(expectedTotal, 5);
  });
});
