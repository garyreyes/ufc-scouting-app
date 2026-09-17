import { describe, expect, it } from "vitest";
import { chunk } from "./chunk";

describe("chunk", () => {
  it("returns an empty array for an empty input", () => {
    expect(chunk([], 100)).toEqual([]);
  });

  it("returns one group when the input is smaller than the size", () => {
    expect(chunk([1, 2, 3], 100)).toEqual([[1, 2, 3]]);
  });

  it("splits evenly when the input is an exact multiple of the size", () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("puts the remainder in a final, shorter group", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
