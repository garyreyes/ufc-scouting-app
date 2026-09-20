import { describe, expect, it } from "vitest";
import { normalizeFightMethod } from "./normalizeFightMethod";

// Every string in this file is a REAL value queried live from
// fights.method on the production project (2026-09-21), not an invented
// fixture -- this function decides whether real money won or lost, so it
// is tested against the prose Wikipedia actually produces.
describe("normalizeFightMethod", () => {
  it("reads every real KO/TKO variant as KO_TKO", () => {
    for (const text of [
      "TKO (punches)",
      "KO (punch)",
      "KO (punches)",
      "TKO (elbows and punches)",
      "TKO (head kick and punches)",
      "TKO (knee to the body and punches)",
      "TKO (spinning back elbow and punches)",
      "KO (punch to the body)",
      // Both of these are still a TKO at every book -- the stoppage
      // reason lives in the parenthetical, not the method.
      "TKO (retirement)",
      "TKO (doctor stoppage)",
    ]) {
      expect(normalizeFightMethod(text), text).toBe("KO_TKO");
    }
  });

  it("reads submissions, including technical submissions, as SUBMISSION", () => {
    expect(normalizeFightMethod("Submission (rear-naked choke)")).toBe("SUBMISSION");
    expect(normalizeFightMethod("Submission (arm-triangle choke)")).toBe("SUBMISSION");
    expect(normalizeFightMethod("Technical Submission (rear-naked choke)")).toBe("SUBMISSION");
  });

  it("reads every decision variant as DECISION", () => {
    expect(normalizeFightMethod("Decision (unanimous) (29–28, 29–28, 29–28)")).toBe("DECISION");
    expect(normalizeFightMethod("Decision (split) (28–29, 29–28, 29–28)")).toBe("DECISION");
    expect(normalizeFightMethod("Decision (majority) (29–28, 29–28, 28–28)")).toBe("DECISION");
    expect(normalizeFightMethod("Technical Decision (unanimous) (29–28, 29–28, 29–28)")).toBe("DECISION");
  });

  // The single most dangerous confusion in this function: a majority DRAW
  // and a majority DECISION share the word "majority", and a draw pays
  // Double Chance while a decision may not. Matching on the leading token
  // rather than searching the whole string is what keeps these apart.
  it("never confuses a majority draw with a majority decision", () => {
    expect(normalizeFightMethod("Draw (majority) (29–27, 28–28, 28–28)")).toBe("DRAW");
    expect(normalizeFightMethod("Draw (majority) (19–19, 19–19, 18–20)")).toBe("DRAW");
    expect(normalizeFightMethod("Decision (majority) (29–28, 29–28, 28–28)")).toBe("DECISION");
  });

  it("separates a no contest from a draw", () => {
    expect(normalizeFightMethod("NC (accidental eye poke)")).toBe("NO_CONTEST");
    expect(normalizeFightMethod("No Contest (accidental eye poke)")).toBe("NO_CONTEST");
    expect(normalizeFightMethod("NC (overturned)")).toBe("NO_CONTEST");
  });

  it("reads a disqualification as its own method", () => {
    expect(normalizeFightMethod("Disqualification (illegal knee)")).toBe("DQ");
    expect(normalizeFightMethod("DQ (grabbing the fence)")).toBe("DQ");
  });

  // 158 settled fights on production carry method = null (they settled
  // from API-Sports, which never reports a method). Returning UNKNOWN
  // rather than guessing is what makes those legs stay pending instead of
  // being silently settled wrong.
  it("returns UNKNOWN rather than guessing when the method is absent or unrecognised", () => {
    expect(normalizeFightMethod(null)).toBe("UNKNOWN");
    expect(normalizeFightMethod("")).toBe("UNKNOWN");
    expect(normalizeFightMethod("   ")).toBe("UNKNOWN");
    expect(normalizeFightMethod("Sorcery (unexplained)")).toBe("UNKNOWN");
  });

  it("is insensitive to case and surrounding whitespace", () => {
    expect(normalizeFightMethod("  tko (punches)  ")).toBe("KO_TKO");
    expect(normalizeFightMethod("SUBMISSION (armbar)")).toBe("SUBMISSION");
  });

  it("handles a bare method with no parenthetical", () => {
    expect(normalizeFightMethod("TKO")).toBe("KO_TKO");
    expect(normalizeFightMethod("Decision")).toBe("DECISION");
  });
});
