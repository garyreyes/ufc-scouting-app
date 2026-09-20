import { describe, expect, it } from "vitest";
import { settleLeg } from "./settleLeg";
import type { LegForSettlement, SettledFightFacts } from "./settleLeg";

const RED = "fighter-red";
const BLUE = "fighter-blue";

function fight(overrides: Partial<SettledFightFacts> = {}): SettledFightFacts {
  return { winnerId: RED, method: "KO_TKO", isCancelled: false, ...overrides };
}

function leg(overrides: Partial<LegForSettlement> = {}): LegForSettlement {
  return {
    market: "MONEYLINE",
    selectionFighterId: RED,
    methodGroup: null,
    ...overrides,
  };
}

describe("settleLeg", () => {
  describe("MONEYLINE", () => {
    it("wins when the backed fighter won", () => {
      expect(settleLeg(leg(), fight())).toBe("won");
    });

    it("loses when the other fighter won", () => {
      expect(settleLeg(leg({ selectionFighterId: BLUE }), fight())).toBe("lost");
    });

    it("voids on a draw -- the stake comes back, it is not a loss", () => {
      expect(settleLeg(leg(), fight({ winnerId: null, method: "DRAW" }))).toBe("void");
    });

    it("voids on a no contest", () => {
      expect(settleLeg(leg(), fight({ winnerId: null, method: "NO_CONTEST" }))).toBe("void");
    });

    it("voids on a cancelled bout", () => {
      expect(settleLeg(leg(), fight({ winnerId: null, method: "UNKNOWN", isCancelled: true }))).toBe("void");
    });

    // Method is irrelevant to a moneyline -- one of the 158 production
    // fights that settled with no method must still settle its moneyline.
    it("settles fine when the fight has no method recorded at all", () => {
      expect(settleLeg(leg(), fight({ method: "UNKNOWN" }))).toBe("won");
    });
  });

  // 1X / 2X: the backed fighter wins OR the fight is drawn.
  describe("DOUBLE_CHANCE", () => {
    const dc = leg({ market: "DOUBLE_CHANCE" });

    it("wins when the backed fighter won", () => {
      expect(settleLeg(dc, fight())).toBe("won");
    });

    // The whole point of the market, and the reason a draw must be
    // distinguishable from a no contest in the first place.
    it("WINS on a draw rather than voiding", () => {
      expect(settleLeg(dc, fight({ winnerId: null, method: "DRAW" }))).toBe("won");
    });

    it("still voids on a no contest, where nothing was decided", () => {
      expect(settleLeg(dc, fight({ winnerId: null, method: "NO_CONTEST" }))).toBe("void");
    });

    it("loses when the other fighter won outright", () => {
      expect(settleLeg(leg({ market: "DOUBLE_CHANCE", selectionFighterId: BLUE }), fight())).toBe("lost");
    });
  });

  describe("METHOD_FIGHTER", () => {
    it("wins when the backed fighter won by the backed method", () => {
      const l = leg({ market: "METHOD_FIGHTER", methodGroup: "KO_TKO_DQ" });
      expect(settleLeg(l, fight({ method: "KO_TKO" }))).toBe("won");
    });

    it("loses when the backed fighter won by a different method", () => {
      const l = leg({ market: "METHOD_FIGHTER", methodGroup: "KO_TKO_DQ" });
      expect(settleLeg(l, fight({ method: "SUBMISSION" }))).toBe("lost");
    });

    it("counts a DQ win inside the KO/TKO/DQ group, as the book's own label says", () => {
      const l = leg({ market: "METHOD_FIGHTER", methodGroup: "KO_TKO_DQ" });
      expect(settleLeg(l, fight({ method: "DQ" }))).toBe("won");
    });

    it("treats ANY_FINISH as everything except a decision", () => {
      const l = leg({ market: "METHOD_FIGHTER", methodGroup: "ANY_FINISH" });
      expect(settleLeg(l, fight({ method: "KO_TKO" }))).toBe("won");
      expect(settleLeg(l, fight({ method: "SUBMISSION" }))).toBe("won");
      expect(settleLeg(l, fight({ method: "DQ" }))).toBe("won");
      expect(settleLeg(l, fight({ method: "DECISION" }))).toBe("lost");
    });

    it("settles a DECISION leg on any decision flavour", () => {
      const l = leg({ market: "METHOD_FIGHTER", methodGroup: "DECISION" });
      expect(settleLeg(l, fight({ method: "DECISION" }))).toBe("won");
      expect(settleLeg(l, fight({ method: "KO_TKO" }))).toBe("lost");
    });

    // Worth settling rather than deferring: if the backed fighter simply
    // lost, the leg is dead no matter what the method was -- so this
    // resolves even for the 158 method-less production fights.
    it("loses without needing the method when the backed fighter lost", () => {
      const l = leg({ market: "METHOD_FIGHTER", methodGroup: "KO_TKO_DQ", selectionFighterId: BLUE });
      expect(settleLeg(l, fight({ winnerId: RED, method: "UNKNOWN" }))).toBe("lost");
    });

    // ...but if the backed fighter WON and the method is unknown, the
    // leg genuinely cannot be decided. Guessing here would settle real
    // money on an assumption.
    it("stays undetermined when the backed fighter won but no method was recorded", () => {
      const l = leg({ market: "METHOD_FIGHTER", methodGroup: "KO_TKO_DQ" });
      expect(settleLeg(l, fight({ winnerId: RED, method: "UNKNOWN" }))).toBe("undetermined");
    });

    it("voids on a draw -- nobody won by any method", () => {
      const l = leg({ market: "METHOD_FIGHTER", methodGroup: "KO_TKO_DQ" });
      expect(settleLeg(l, fight({ winnerId: null, method: "DRAW" }))).toBe("void");
    });
  });

  // "How The Bout Will Be Won. KO/TKO/DQ" -- names no fighter.
  describe("METHOD_FIGHT", () => {
    const l = leg({ market: "METHOD_FIGHT", selectionFighterId: null, methodGroup: "KO_TKO_DQ" });

    it("wins on the method regardless of which fighter won", () => {
      expect(settleLeg(l, fight({ winnerId: RED, method: "KO_TKO" }))).toBe("won");
      expect(settleLeg(l, fight({ winnerId: BLUE, method: "KO_TKO" }))).toBe("won");
    });

    it("loses when the bout ended another way", () => {
      expect(settleLeg(l, fight({ method: "DECISION" }))).toBe("lost");
    });

    it("stays undetermined when no method was recorded", () => {
      expect(settleLeg(l, fight({ method: "UNKNOWN" }))).toBe("undetermined");
    });

    it("voids on a draw", () => {
      expect(settleLeg(l, fight({ winnerId: null, method: "DRAW" }))).toBe("void");
    });
  });

  describe("legs this app cannot settle", () => {
    // The real tennis leg in one of the owner's accumulators.
    it("leaves a leg with no fight row undetermined", () => {
      expect(settleLeg(leg({ market: "OTHER", selectionFighterId: null }), null)).toBe("undetermined");
    });

    it("leaves an OTHER market undetermined even when a fight row exists", () => {
      expect(settleLeg(leg({ market: "OTHER", selectionFighterId: null }), fight())).toBe("undetermined");
    });

    it("leaves any leg undetermined while its fight has not settled", () => {
      expect(settleLeg(leg(), null)).toBe("undetermined");
    });
  });
});
