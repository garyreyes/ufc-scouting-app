import { describe, expect, it } from "vitest";
import { predictInternMethod } from "./predictInternMethod";
import { FIGHT_METHODS, type FightMethod } from "../scoring/fightMethod";

describe("predictInternMethod", () => {
  it("predicts a decision for a close matchup at any weight", () => {
    // Lopsidedness ~0 -> the finish pool never overtakes decision,
    // whatever the division.
    expect(predictInternMethod(0.5, "Lightweight").method).toBe("DECISION");
    expect(predictInternMethod(0.52, "Heavyweight").method).toBe("DECISION");
    expect(predictInternMethod(0.53, "Women's Strawweight").method).toBe("DECISION");
  });

  it("predicts KO/TKO for a lopsided heavyweight bout", () => {
    expect(predictInternMethod(0.8, "Heavyweight").method).toBe("KO_TKO");
    // "Light Heavyweight" contains "heavyweight" and is also KO-heavy --
    // the bucket match is intentional.
    expect(predictInternMethod(0.8, "Light Heavyweight").method).toBe("KO_TKO");
  });

  it("predicts a submission for a lopsided light-division bout", () => {
    // The case the old tuning made unreachable: in a light division the
    // finish pool splits toward submission, so a clear favourite there
    // is predicted to submit rather than KO.
    expect(predictInternMethod(0.8, "Women's Strawweight").method).toBe("SUBMISSION");
    expect(predictInternMethod(0.78, "Flyweight").method).toBe("SUBMISSION");
    expect(predictInternMethod(0.8, "Bantamweight").method).toBe("SUBMISSION");
  });

  it("leans KO/TKO for a lopsided mid-division bout", () => {
    expect(predictInternMethod(0.82, "Welterweight").method).toBe("KO_TKO");
    expect(predictInternMethod(0.82, "Middleweight").method).toBe("KO_TKO");
  });

  it("lets a competitive heavyweight fight still be a decision", () => {
    // Finding-2 regression: heavy must NOT be KO regardless of matchup.
    expect(predictInternMethod(0.54, "Heavyweight").method).toBe("DECISION");
  });

  it("every method is reachable across the input grid -- no dead branch", () => {
    // The bug this file exists to prevent: a set of constants under which
    // one FightMethod can never be the argmax for any input.
    const weights = ["Heavyweight", "Welterweight", "Flyweight", "Women's Bantamweight", null];
    const seen = new Set<FightMethod>();
    for (const w of weights) {
      for (let p = 0.5; p <= 1.0001; p += 0.01) {
        seen.add(predictInternMethod(p, w).method);
      }
    }
    for (const m of FIGHT_METHODS) {
      expect(seen.has(m)).toBe(true);
    }
  });

  it("is deterministic -- same inputs, same output", () => {
    expect(predictInternMethod(0.77, "Middleweight")).toEqual(
      predictInternMethod(0.77, "Middleweight"),
    );
  });

  it("treats an unknown or missing weight class as mid-weight without crashing", () => {
    expect(() => predictInternMethod(0.6, null)).not.toThrow();
    expect(() => predictInternMethod(0.6, "")).not.toThrow();
    expect(() => predictInternMethod(0.6, "Catchweight (165 lbs)")).not.toThrow();
    expect(predictInternMethod(0.5, null).method).toBe("DECISION");
  });

  it("does not care which side of 0.5 the probability is", () => {
    expect(predictInternMethod(0.8, "Flyweight").method).toBe(
      predictInternMethod(0.2, "Flyweight").method,
    );
  });

  it("returns a human-readable note naming the method", () => {
    expect(predictInternMethod(0.85, "Heavyweight").note.toLowerCase()).toContain("ko");
    expect(predictInternMethod(0.85, "Flyweight").note.toLowerCase()).toContain("submission");
    expect(predictInternMethod(0.5, "Lightweight").note.toLowerCase()).toContain("decision");
  });
});
