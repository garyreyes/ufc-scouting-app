import { describe, expect, it } from "vitest";
import { probabilityForFighter } from "./probabilityForFighter";

// docs/PRD.md UC-2: "a bet may be placed on the fighter I did not pick."
// The schema stores one estimated_probability per row, always meaning
// P(predicted_fighter_id wins) -- so live edge for a bet on the *other*
// fighter must derive P(bet_fighter wins) = 1 - estimated_probability,
// never reuse the predicted fighter's own number. Getting this backwards
// silently flips the sign of every displayed edge for an against-the-pick
// bet -- money math, ARCHITECTURE.md item #2's dependency chain.
const FIGHTER_A = "fighter-a";
const FIGHTER_B = "fighter-b";

describe("probabilityForFighter", () => {
  it("returns estimated_probability unchanged when betting the predicted fighter", () => {
    expect(probabilityForFighter(FIGHTER_A, FIGHTER_A, 0.7)).toBe(0.7);
  });

  it("returns 1 - estimated_probability when betting the other fighter", () => {
    expect(probabilityForFighter(FIGHTER_B, FIGHTER_A, 0.7)).toBeCloseTo(0.3, 10);
  });

  it("the PRD's own -6000 favourite example: betting the dog derives its real complement", () => {
    // Predicted the favourite at 98.4% (decimal 1.0167); betting the dog
    // instead should read as roughly 1.6%, not 98.4%.
    expect(probabilityForFighter(FIGHTER_B, FIGHTER_A, 0.9836)).toBeCloseTo(0.0164, 4);
  });
});
