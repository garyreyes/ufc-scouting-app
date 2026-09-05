import { describe, expect, it } from "vitest";
import { predictInternMethod } from "./predictInternMethod";

describe("predictInternMethod", () => {
  it("predicts a decision for a coin-flip matchup at a mid-weight", () => {
    // No lopsidedness shift, no weight tilt -- base rates alone, and
    // decision is the plurality.
    expect(predictInternMethod(0.5, "Lightweight").method).toBe("DECISION");
    expect(predictInternMethod(0.52, "Welterweight").method).toBe("DECISION");
  });

  it("predicts a finish for a heavily lopsided matchup", () => {
    // A mismatch ends early -- the finish shift pulls enough mass out of
    // decision that a finish method wins the argmax.
    expect(predictInternMethod(0.95, "Lightweight").method).not.toBe("DECISION");
  });

  it("leans KO/TKO for a lopsided heavyweight bout", () => {
    expect(predictInternMethod(0.9, "Heavyweight").method).toBe("KO_TKO");
    // "Light Heavyweight" contains "heavyweight" and is also KO-heavy --
    // the bucket match is intentional, not a bug.
    expect(predictInternMethod(0.9, "Light Heavyweight").method).toBe("KO_TKO");
  });

  it("leans back toward decision for a moderately lopsided light-division bout", () => {
    // Lighter divisions go the distance far more often; a 0.68 favourite
    // at strawweight should not read as a likely finish.
    expect(predictInternMethod(0.68, "Women's Strawweight").method).toBe("DECISION");
    expect(predictInternMethod(0.68, "Flyweight").method).toBe("DECISION");
  });

  it("is deterministic -- same inputs, same output", () => {
    const a = predictInternMethod(0.77, "Middleweight");
    const b = predictInternMethod(0.77, "Middleweight");
    expect(a).toEqual(b);
  });

  it("treats an unknown or missing weight class as mid-weight without crashing", () => {
    expect(() => predictInternMethod(0.6, null)).not.toThrow();
    expect(() => predictInternMethod(0.6, "")).not.toThrow();
    expect(() => predictInternMethod(0.6, "Catchweight (165 lbs)")).not.toThrow();
    expect(predictInternMethod(0.5, null).method).toBe("DECISION");
  });

  it("does not care which side of 0.5 the probability is -- it's the winner's, but guard anyway", () => {
    expect(predictInternMethod(0.95, "Lightweight").method).toBe(
      predictInternMethod(0.05, "Lightweight").method,
    );
  });

  it("returns a human-readable note naming the method and why", () => {
    const { note } = predictInternMethod(0.92, "Heavyweight");
    expect(note.toLowerCase()).toContain("ko");
  });
});
