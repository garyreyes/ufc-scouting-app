import { describe, expect, it } from "vitest";
import { applyInternDelta, INTERN_V1, INTERN_V2, modelVersionOf } from "./internModel";

describe("applyInternDelta", () => {
  it("v1 applies the full clamped delta, exactly as applyProbabilityDelta did", () => {
    expect(applyInternDelta(0.6, 0.2, INTERN_V1)).toBeCloseTo(0.8, 10);
  });

  it("v2 applies only signalWeight (0.35) of the delta -- the market does most of the talking", () => {
    expect(applyInternDelta(0.6, 0.2, INTERN_V2)).toBeCloseTo(0.67, 10);
    expect(applyInternDelta(0.6, -0.2, INTERN_V2)).toBeCloseTo(0.53, 10);
  });

  it("v2 clamps to [0.03, 0.97] -- never the 0.99 reads v1 produced", () => {
    expect(applyInternDelta(0.95, 0.25, INTERN_V2)).toBe(0.97);
    expect(applyInternDelta(0.05, -0.25, INTERN_V2)).toBe(0.03);
  });

  it("v1 keeps its original (0.01, 0.99) clamp", () => {
    expect(applyInternDelta(0.9, 0.25, INTERN_V1)).toBe(0.99);
  });

  it("a zero delta returns the market anchor unchanged in both versions", () => {
    expect(applyInternDelta(0.42, 0, INTERN_V1)).toBeCloseTo(0.42, 10);
    expect(applyInternDelta(0.42, 0, INTERN_V2)).toBeCloseTo(0.42, 10);
  });
});

describe("modelVersionOf", () => {
  it("reads v2 from a stored signals object", () => {
    expect(modelVersionOf({ modelVersion: "v2" })).toBe("v2");
  });

  it("treats a missing version, missing signals, or garbage as v1 (every pre-Phase-S pick)", () => {
    expect(modelVersionOf({ clampedDelta: 0.1 })).toBe("v1");
    expect(modelVersionOf(null)).toBe("v1");
    expect(modelVersionOf({ modelVersion: "v9" })).toBe("v1");
  });
});
