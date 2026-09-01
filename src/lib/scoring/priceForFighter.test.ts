import { describe, expect, it } from "vitest";
import { priceForFighter } from "./priceForFighter";

// Picking the wrong side's decimal price flips the sign of a live edge
// display outright (a positive read shown as negative or vice versa) --
// the same class of expensive, silent bug ARCHITECTURE.md item #2 exists
// to guard against, even though this is a lookup rather than a formula.
const FIGHTER_A = "fighter-a";
const FIGHTER_B = "fighter-b";
const ODDS = { fighter1_price: 1.5, fighter2_price: 2.8 };

describe("priceForFighter", () => {
  it("returns fighter1_price when the fighter is fighter1", () => {
    expect(priceForFighter(FIGHTER_A, FIGHTER_A, FIGHTER_B, ODDS)).toBe(1.5);
  });

  it("returns fighter2_price when the fighter is fighter2", () => {
    expect(priceForFighter(FIGHTER_B, FIGHTER_A, FIGHTER_B, ODDS)).toBe(2.8);
  });

  it("returns null when odds is null (fight not yet priced)", () => {
    expect(priceForFighter(FIGHTER_A, FIGHTER_A, FIGHTER_B, null)).toBeNull();
  });
});
