import { describe, expect, it } from "vitest";
import { determineFavorite } from "./determineFavorite";

// Chalk's own definition (docs/PRD.md UC-4: "flat 1u on every favourite,
// every fight") needs to know which fighter the market favours -- lower
// decimal odds means higher implied probability, so lower price is the
// favourite. Getting this backwards would make the chalk control bet the
// underdog on every single fight, silently inverting the entire baseline
// the units board is measured against.
const FIGHTER_A = "fighter-a";
const FIGHTER_B = "fighter-b";

describe("determineFavorite", () => {
  it("picks fighter1 when fighter1 has the lower price", () => {
    const result = determineFavorite(FIGHTER_A, FIGHTER_B, { fighter1_price: 1.5, fighter2_price: 2.8 });
    expect(result).toEqual({ favoriteId: FIGHTER_A, favoritePrice: 1.5 });
  });

  it("picks fighter2 when fighter2 has the lower price", () => {
    const result = determineFavorite(FIGHTER_A, FIGHTER_B, { fighter1_price: 3.2, fighter2_price: 1.4 });
    expect(result).toEqual({ favoriteId: FIGHTER_B, favoritePrice: 1.4 });
  });

  it("breaks an exact tie toward fighter1, deterministically", () => {
    const result = determineFavorite(FIGHTER_A, FIGHTER_B, { fighter1_price: 2.0, fighter2_price: 2.0 });
    expect(result).toEqual({ favoriteId: FIGHTER_A, favoritePrice: 2.0 });
  });
});
