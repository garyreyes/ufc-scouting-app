import { describe, expect, it } from "vitest";
import { settleSlip } from "./settleSlip";
import type { LegForRollup } from "./settleSlip";

function legs(...specs: [LegForRollup["result"], number][]): LegForRollup[] {
  return specs.map(([result, price]) => ({ result, price }));
}

describe("settleSlip", () => {
  it("pays a winning single at its own price", () => {
    expect(settleSlip(legs(["won", 2.53]), 300)).toEqual({ status: "won", payoutPhp: 759 });
  });

  it("returns nothing on a losing single", () => {
    expect(settleSlip(legs(["lost", 2.53]), 300)).toEqual({ status: "lost", payoutPhp: 0 });
  });

  it("multiplies every leg price on a winning accumulator", () => {
    expect(settleSlip(legs(["won", 1.22], ["won", 1.65]), 300)).toEqual({
      status: "won",
      payoutPhp: 603.9,
    });
  });

  it("stays open while any leg is still undecided", () => {
    expect(settleSlip(legs(["won", 1.5], ["undetermined", 2]), 100)).toEqual({ status: "open" });
    expect(settleSlip(legs(["pending", 1.5]), 100)).toEqual({ status: "open" });
  });

  // A parlay cannot recover: once one leg is dead the ticket is dead,
  // whatever the remaining legs do. Settling this immediately (rather
  // than waiting for the rest of the card) is what lets the bankroll
  // reflect a lost slip on the night instead of days later.
  it("is lost the moment any leg loses, even with legs still undecided", () => {
    expect(settleSlip(legs(["lost", 1.3], ["undetermined", 2.2]), 200)).toEqual({
      status: "lost",
      payoutPhp: 0,
    });
  });

  describe("void legs", () => {
    it("returns the stake when every leg voided", () => {
      expect(settleSlip(legs(["void", 2], ["void", 3]), 250)).toEqual({
        status: "void",
        payoutPhp: 250,
      });
    });

    // Standard book rule, and the subtlest money path here: a voided leg
    // drops out and the accumulator reprices on the legs that remain --
    // it does NOT pay at the original combined odds, and it does NOT
    // lose.
    it("drops a voided leg and reprices the rest", () => {
      expect(settleSlip(legs(["won", 2], ["void", 3], ["won", 1.5]), 100)).toEqual({
        status: "won",
        payoutPhp: 300,
      });
    });

    it("still loses if a surviving leg lost", () => {
      expect(settleSlip(legs(["void", 3], ["lost", 1.5]), 100)).toEqual({
        status: "lost",
        payoutPhp: 0,
      });
    });

    it("treats a single voided leg as a returned stake", () => {
      expect(settleSlip(legs(["void", 4.5]), 150)).toEqual({ status: "void", payoutPhp: 150 });
    });
  });

  it("rounds the payout to whole centavos", () => {
    // 74.59 * 3.705 = 276.35595
    expect(settleSlip(legs(["won", 3.705]), 74.59)).toEqual({ status: "won", payoutPhp: 276.36 });
  });

  it("is a no-op shape on a slip with no legs", () => {
    expect(settleSlip([], 100)).toEqual({ status: "open" });
  });

  // ------------------------------------------------------------------
  // Acceptance: the owner's 16 real tickets (Aug 23 - Sep 13 2026).
  // Every expected payout below is the figure printed on the actual bet
  // slip, not a number this engine produced. If the settlement math is
  // wrong anywhere, one of these disagrees with reality.
  // ------------------------------------------------------------------
  describe("real tickets", () => {
    const tickets: {
      ref: string;
      legs: LegForRollup[];
      stake: number;
      expected: { status: string; payoutPhp: number };
    }[] = [
      { ref: "86025536447 Mederos ML (promo)", legs: legs(["won", 3.705]), stake: 74.59, expected: { status: "won", payoutPhp: 276.36 } },
      { ref: "86268928063 Dhant ML", legs: legs(["won", 2.53]), stake: 300, expected: { status: "won", payoutPhp: 759 } },
      { ref: "86734905105 Bukauskas ML", legs: legs(["won", 2.85]), stake: 150, expected: { status: "won", payoutPhp: 427.5 } },
      { ref: "86731494457 Sintes ML", legs: legs(["won", 2.215]), stake: 250, expected: { status: "won", payoutPhp: 553.75 } },
      { ref: "86733149383 Wood by finish", legs: legs(["lost", 3]), stake: 150, expected: { status: "lost", payoutPhp: 0 } },
      { ref: "86739093493 Naimov ML", legs: legs(["lost", 3.54]), stake: 150, expected: { status: "lost", payoutPhp: 0 } },
      { ref: "86746067039 Hooker ML", legs: legs(["lost", 5.05]), stake: 150, expected: { status: "lost", payoutPhp: 0 } },
      // The third leg's price (2.15, Axel Sola) was cut off in the
      // screenshot and derived from the product rule. That this ticket
      // reproduces its printed P2,595.05 payout is the confirmation the
      // derivation was right.
      { ref: "3-leg acca (Lima / Duclos / Sola)", legs: legs(["won", 1.42], ["won", 1.7], ["won", 2.15]), stake: 500, expected: { status: "won", payoutPhp: 2595.05 } },
      { ref: "87135020559 Grasso double chance", legs: legs(["won", 2.9]), stake: 300, expected: { status: "won", payoutPhp: 870 } },
      { ref: "87137119625 Gantt + Belgaroui", legs: legs(["won", 1.22], ["won", 1.65]), stake: 300, expected: { status: "won", payoutPhp: 603.9 } },
      { ref: "87136262219 Rahiki by decision", legs: legs(["lost", 7.2]), stake: 250, expected: { status: "lost", payoutPhp: 0 } },
      // Third leg unknown (cut off) -- irrelevant, the Cortes Acosta leg
      // already lost. Exercises "dead on first loss" against real data.
      { ref: "3-leg acca (Malpica / Cortes Acosta / Martinez)", legs: legs(["won", 1.32], ["lost", 1.45], ["undetermined", 1.23]), stake: 200, expected: { status: "lost", payoutPhp: 0 } },
      { ref: "18.228 longshot (Zhu Rong / Bahamondes / Elliott)", legs: legs(["lost", 4.2], ["lost", 2], ["undetermined", 2.17]), stake: 100, expected: { status: "lost", payoutPhp: 0 } },
      { ref: "87166074343 Elliott ML", legs: legs(["won", 6.18]), stake: 103.9, expected: { status: "won", payoutPhp: 642.1 } },
      // Includes a US Open tennis leg. The engine neither knows nor
      // cares that it is not MMA -- it is a price and a result.
      { ref: "87168965839 Sabalenka + Blaydes", legs: legs(["won", 1.68], ["won", 2.664]), stake: 100, expected: { status: "won", payoutPhp: 447.55 } },
      { ref: "87172232557 Morales + Silva methods", legs: legs(["lost", 2.45], ["lost", 1.8]), stake: 300, expected: { status: "lost", payoutPhp: 0 } },
    ];

    it.each(tickets)("reproduces the printed result for $ref", ({ legs: slipLegs, stake, expected }) => {
      expect(settleSlip(slipLegs, stake)).toEqual(expected);
    });

    // The portfolio-level check. Individual slips could each be subtly
    // wrong in compensating ways; this pins the actual bankroll movement.
    it("reproduces the whole portfolio: P3,378.49 staked, P7,175.21 returned, +P3,796.72 net", () => {
      let staked = 0;
      let returned = 0;
      for (const t of tickets) {
        const result = settleSlip(t.legs, t.stake);
        staked += t.stake;
        returned += "payoutPhp" in result ? result.payoutPhp : 0;
      }
      expect(Number(staked.toFixed(2))).toBe(3378.49);
      expect(Number(returned.toFixed(2))).toBe(7175.21);
      expect(Number((returned - staked).toFixed(2))).toBe(3796.72);
    });

    it("is 9 wins and 7 losses", () => {
      const statuses = tickets.map((t) => settleSlip(t.legs, t.stake).status);
      expect(statuses.filter((s) => s === "won")).toHaveLength(9);
      expect(statuses.filter((s) => s === "lost")).toHaveLength(7);
    });
  });
});
