import { describe, expect, it } from "vitest";
import { applyEnteredPrices, availableBalance, generationKey, slateSignature } from "./slatePersistence";
import type { SlateLeg, SlateSlip } from "./types";

function leg(o: Partial<SlateLeg> = {}): SlateLeg {
  return {
    fightId: "b",
    market: "METHOD_FIGHTER",
    selectionFighterId: "b-1",
    selectionDetail: "B One by KO/TKO/DQ",
    methodGroup: "KO_TKO_DQ",
    price: 1.74,
    priceSource: "estimated",
    modelProbability: 0.48,
    ...o,
  };
}

function slip(legs: SlateLeg[], o: Partial<SlateSlip> = {}): SlateSlip {
  return { archetype: "METHOD_PARLAY", index: 0, legs, combinedPrice: 3.654, modelProbability: 0.2, stakePhp: 125, ...o };
}

describe("availableBalance", () => {
  it("is the ledger total (strings from PostgREST included) minus stakes still riding on other cards", () => {
    expect(availableBalance(["10000.00", "-250.00", 431.5], ["300.00", 125])).toBeCloseTo(9756.5, 10);
  });
});

describe("applyEnteredPrices", () => {
  const entered = [
    { fightId: "b", market: "METHOD_FIGHTER", selectionFighterId: "b-1", methodGroup: "KO_TKO_DQ", price: 2.1 },
  ];

  it("carries an owner-entered price onto the matching regenerated leg and recomputes the combined price", () => {
    const other = leg({ fightId: "d", selectionFighterId: "d-2", methodGroup: "ANY_FINISH", price: 2.1 });
    const [out] = applyEnteredPrices([slip([leg(), other])], entered);
    expect(out.legs[0]).toMatchObject({ price: 2.1, priceSource: "entered" });
    expect(out.legs[1]).toMatchObject({ price: 2.1, priceSource: "estimated" });
    expect(out.combinedPrice).toBe(4.41);
  });

  it("does not carry a price onto a leg whose method changed", () => {
    const [out] = applyEnteredPrices([slip([leg({ methodGroup: "DECISION" })])], entered);
    expect(out.legs[0]).toMatchObject({ price: 1.74, priceSource: "estimated" });
  });
});

describe("slateSignature", () => {
  it("is equal for the same slate and differs when a stake or a price moves", () => {
    const base = [slip([leg()])];
    expect(slateSignature(base)).toBe(slateSignature([slip([leg()])]));
    expect(slateSignature(base)).not.toBe(slateSignature([slip([leg()], { stakePhp: 124 })]));
    expect(slateSignature(base)).not.toBe(slateSignature([slip([leg({ price: 1.75 })])]));
  });

  // Reviewer finding: legs read back from the bet_legs embed come in no
  // guaranteed order, so a multi-leg slip must not look changed just because
  // its legs were returned in a different order.
  it("ignores leg order within a slip", () => {
    const other = leg({ fightId: "d", selectionFighterId: "d-2", methodGroup: "ANY_FINISH", price: 2.1 });
    expect(slateSignature([slip([leg(), other])])).toBe(slateSignature([slip([other, leg()])]));
  });
});

describe("generationKey", () => {
  it("is intern:{event}:{archetype}:{index}", () => {
    expect(generationKey("ev-1", "STRAIGHT_DOG", 2)).toBe("intern:ev-1:STRAIGHT_DOG:2");
  });
});
