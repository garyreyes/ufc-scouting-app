import { describe, expect, it } from "vitest";
import { edge } from "./edge";

describe("edge", () => {
  it("is negative when the estimate agrees with a heavy favourite's own implied probability", () => {
    // Believing the -6000 favourite at exactly its own 98.4% implied
    // probability is still unbackable: edge = 0.984 * 1.0167 - 1 ≈ 0,
    // and any honest estimate below 98.4% (nobody should be more
    // confident than the market on a near-certainty) goes negative --
    // "worthless to back," the PRD's own words.
    expect(edge(0.9836, 1.0167)).toBeCloseTo(0, 3);
  });

  it("is positive when the estimate exceeds the market's implied probability", () => {
    // An underdog priced at 28.6% implied (decimal 3.5) that you actually
    // think wins 40% of the time: edge = 0.40 * 3.5 - 1 = 0.4.
    expect(edge(0.4, 3.5)).toBeCloseTo(0.4, 4);
  });

  it("is negative when the estimate is below the market's implied probability", () => {
    // The same underdog, but you only believe 20% -- worse than the
    // market's own 28.6% read, so backing it is a bad bet regardless of
    // it being a live underdog.
    expect(edge(0.2, 3.5)).toBeLessThan(0);
  });
});
