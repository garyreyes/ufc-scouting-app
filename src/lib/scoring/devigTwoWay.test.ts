import { describe, expect, it } from "vitest";
import { devigTwoWay } from "./devigTwoWay";

describe("devigTwoWay", () => {
  it("returns two probabilities that sum to exactly 1", () => {
    const { prob1, prob2 } = devigTwoWay(1.73, 2.17);
    expect(prob1 + prob2).toBeCloseTo(1, 10);
  });

  it("strips the bookmaker overround -- raw implied would sum to > 1", () => {
    // 1/1.73 + 1/2.17 sums to ~1.039; the extra 0.039 is the book's
    // margin. De-vigging rescales the pair to 1 while keeping their
    // ratio, so the favourite's number lands below its raw 1/1.73.
    const { prob1 } = devigTwoWay(1.73, 2.17);
    const rawFav = 1 / 1.73;
    const rawTotal = 1 / 1.73 + 1 / 2.17;
    expect(prob1).toBeCloseTo(rawFav / rawTotal, 10);
    expect(prob1).toBeLessThan(rawFav);
    expect(rawTotal).toBeGreaterThan(1);
  });

  it("gives an even-money pair 50/50", () => {
    const { prob1, prob2 } = devigTwoWay(2, 2);
    expect(prob1).toBeCloseTo(0.5, 10);
    expect(prob2).toBeCloseTo(0.5, 10);
  });

  it("puts the shorter price on the higher probability", () => {
    const { prob1, prob2 } = devigTwoWay(1.2, 4.5);
    expect(prob1).toBeGreaterThan(prob2);
  });

  it("matches the anchor decideInternPick computed inline before this was extracted", () => {
    // The exact arithmetic that used to live in decideInternPick.ts:
    //   raw1 = 1/price1; raw2 = 1/price2; anchor1 = raw1 / (raw1 + raw2)
    const price1 = 1.45;
    const price2 = 2.9;
    const raw1 = 1 / price1;
    const raw2 = 1 / price2;
    const expected = raw1 / (raw1 + raw2);
    expect(devigTwoWay(price1, price2).prob1).toBeCloseTo(expected, 12);
  });
});
