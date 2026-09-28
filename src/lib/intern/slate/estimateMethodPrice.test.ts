import { describe, expect, it } from "vitest";
import { estimateMethodPrice, methodGroupFor, methodProbability } from "./estimateMethodPrice";

describe("estimateMethodPrice", () => {
  it("prices a leg at fair odds loaded with a 20% prop margin, rounded to 2 dp", () => {
    // 1 / (0.48 x 1.2) = 1.7361
    expect(estimateMethodPrice(0.48)).toBe(1.74);
    // 1 / (0.396 x 1.2) = 2.1044
    expect(estimateMethodPrice(0.396)).toBe(2.1);
    // 1 / (0.336 x 1.2) = 2.4802
    expect(estimateMethodPrice(0.336)).toBe(2.48);
  });

  it("never prices below 1.01 (bet_legs.price must exceed 1)", () => {
    expect(estimateMethodPrice(0.9)).toBe(1.01);
  });
});

describe("methodGroupFor", () => {
  it("maps the Intern's method call onto the settleable bet_legs groups", () => {
    expect(methodGroupFor("DECISION")).toBe("DECISION");
    expect(methodGroupFor("KO_TKO")).toBe("KO_TKO_DQ");
    expect(methodGroupFor("SUBMISSION")).toBe("SUBMISSION");
    expect(methodGroupFor("FINISH")).toBe("ANY_FINISH");
  });
});

describe("methodProbability", () => {
  const dist = { dec: 0.35, ko: 0.4, sub: 0.25 };

  it("is P(win) x P(method), with ANY_FINISH covering both KO and submission", () => {
    expect(methodProbability(0.63, "ANY_FINISH", dist)).toBeCloseTo(0.4095, 10);
    expect(methodProbability(0.63, "DECISION", dist)).toBeCloseTo(0.2205, 10);
    expect(methodProbability(0.63, "KO_TKO_DQ", dist)).toBeCloseTo(0.252, 10);
    expect(methodProbability(0.63, "SUBMISSION", dist)).toBeCloseTo(0.1575, 10);
  });
});
