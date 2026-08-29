import { describe, expect, it } from "vitest";
import { stripNullish } from "./stripNullish";

// stripNullish guards a real data-loss path: both sync sources write to the
// same fight/fighter rows, and each knows fields the other doesn't. A key
// that survives when it shouldn't blanks out data the other source supplied.
describe("stripNullish", () => {
  it("drops null and undefined keys", () => {
    expect(stripNullish({ method: null, round: undefined, winner_id: "abc" })).toEqual({
      winner_id: "abc",
    });
  });

  // The bug this exists to prevent: a truthiness filter instead of an
  // explicit null/undefined check. Fighters default wins/losses/draws to 0
  // and a first-round finish is round 1 -- but a draw is 0, and an empty
  // weight_class string is still a real "this source says it's blank".
  it("keeps falsy values that carry meaning", () => {
    const input = { draws: 0, weight_class: "", is_title_fight: false };
    expect(stripNullish(input)).toEqual(input);
  });

  it("returns an empty object when every value is nullish", () => {
    expect(stripNullish({ a: null, b: undefined })).toEqual({});
  });

  it("does not mutate its input", () => {
    const input = { method: null, round: 3 };
    stripNullish(input);
    expect(input).toEqual({ method: null, round: 3 });
  });
});
