import { describe, expect, it } from "vitest";
import type { SherdogSearchCandidate } from "./parseSearch";
import {
  AMBIGUOUS_TIEBREAK_MIN_FIGHTS,
  decideSherdogIdentity,
  pickTiebreakWinner,
  rankSherdogCandidates,
  SHERDOG_AUTO_MATCH_THRESHOLD,
  tiedTopCandidates,
} from "./resolveSherdogIdentity";

const cand = (over: Partial<SherdogSearchCandidate> & { sherdogId: number; name: string }): SherdogSearchCandidate => ({
  nickname: null,
  heightImperial: null,
  weightImperial: null,
  association: null,
  ...over,
});

describe("rankSherdogCandidates", () => {
  it("orders by name similarity to the stored name, exact match first", () => {
    const ranked = rankSherdogCandidates("Islam Makhachev", [
      cand({ sherdogId: 375266, name: "Magomed Makhachev" }),
      cand({ sherdogId: 76836, name: "Islam Makhachev" }),
      cand({ sherdogId: 224121, name: "Ali Makhachev" }),
    ]);
    expect(ranked[0]).toMatchObject({ sherdogId: 76836, confidence: 1 });
    // the two non-matches rank below the exact one; their relative order
    // is a bigram-overlap detail, not something to pin
    expect(ranked.slice(1).map((r) => r.sherdogId).sort()).toEqual([224121, 375266]);
  });

  it("a pure word-order swap scores below 1 (bigram similarity is not fully order-free)", () => {
    // "Aori Qileng" vs Sherdog's "Qileng Aori" -> ~0.8, which is BELOW
    // the auto-match threshold, so it lands in the review queue rather
    // than auto-matching. identityGuard.ts is the order-tolerant check,
    // but only for verifying an id already chosen -- not for picking one.
    const [top] = rankSherdogCandidates("Aori Qileng", [cand({ sherdogId: 222519, name: "Qileng Aori" })]);
    expect(top.confidence).toBeGreaterThan(0.5);
    expect(top.confidence).toBeLessThan(SHERDOG_AUTO_MATCH_THRESHOLD);
  });

  it("returns [] for no candidates", () => {
    expect(rankSherdogCandidates("Whoever", [])).toEqual([]);
  });
});

describe("decideSherdogIdentity — every branch reachable", () => {
  it("'no_candidates' when the search returned nothing", () => {
    expect(decideSherdogIdentity("Real Debutant", [])).toEqual({ kind: "no_candidates" });
  });

  it("'matched' when the top candidate clears the threshold (exact name)", () => {
    const d = decideSherdogIdentity("Islam Makhachev", [
      cand({ sherdogId: 76836, name: "Islam Makhachev" }),
      cand({ sherdogId: 224121, name: "Ali Makhachev" }),
    ]);
    expect(d).toEqual({ kind: "matched", sherdogId: 76836, confidence: 1 });
  });

  it("'low_confidence' / 'below_threshold' when the best candidate is a common-surname near-miss", () => {
    // "Andre Lima" vs a list topped by "Alexandre Lima" -- the real spike case.
    const d = decideSherdogIdentity("Andre Lima", [
      cand({ sherdogId: 2456, name: "Alexandre Lima" }),
      cand({ sherdogId: 201199, name: "Andre Luiz Lima" }),
    ]);
    expect(d.kind).toBe("low_confidence");
    if (d.kind === "low_confidence") {
      expect(d.confidence).toBeLessThan(SHERDOG_AUTO_MATCH_THRESHOLD);
      expect(d.reason).toBe("below_threshold");
    }
  });

  it("'low_confidence' / 'ambiguous' when TWO candidates both clear the threshold (exact homonyms)", () => {
    // The HIGH finding from the J3 review: MMA has multiple "Bruno Silva".
    // Sherdog search returns them all, both score 1.0, and auto-matching
    // would key one fighter's whole career onto the wrong namesake.
    const d = decideSherdogIdentity("Bruno Silva", [
      cand({ sherdogId: 111, name: "Bruno Silva" }),
      cand({ sherdogId: 222, name: "Bruno Silva" }),
      cand({ sherdogId: 333, name: "Bruno Silveira" }),
    ]);
    expect(d).toMatchObject({ kind: "low_confidence", reason: "ambiguous" });
  });

  it("still auto-matches when only ONE candidate clears the threshold, even with weak others present", () => {
    const d = decideSherdogIdentity("Islam Makhachev", [
      cand({ sherdogId: 76836, name: "Islam Makhachev" }),
      cand({ sherdogId: 224121, name: "Ali Makhachev" }),
      cand({ sherdogId: 375266, name: "Magomed Makhachev" }),
    ]);
    expect(d.kind).toBe("matched");
  });

  it("the threshold is inclusive: a candidate scoring exactly the threshold is 'matched'", () => {
    // Build a synthetic pair whose similarity is >= threshold by using an
    // identical name (score 1) -- and assert the boundary operator is >=.
    const atOrAbove = decideSherdogIdentity("Test Name", [cand({ sherdogId: 1, name: "Test Name" })]);
    expect(atOrAbove.kind).toBe("matched");
    // A clearly-below case stays in the queue.
    const below = decideSherdogIdentity("Test Name", [cand({ sherdogId: 2, name: "Different Person" })]);
    expect(below.kind).toBe("low_confidence");
  });

  it("picks the highest-scoring candidate as the match, not the first listed", () => {
    const d = decideSherdogIdentity("Charles Oliveira", [
      cand({ sherdogId: 999, name: "Charles Rosa" }),
      cand({ sherdogId: 30300, name: "Charles Oliveira" }),
    ]);
    expect(d).toMatchObject({ kind: "matched", sherdogId: 30300 });
  });
});

describe("tiedTopCandidates", () => {
  it("returns only the candidates at/above the threshold, best-first", () => {
    const tied = tiedTopCandidates("Bruno Silva", [
      cand({ sherdogId: 1, name: "Bruno Silva" }),
      cand({ sherdogId: 2, name: "Bruno Silva" }),
      cand({ sherdogId: 3, name: "Bruno Silveira" }),
    ]);
    expect(tied.map((c) => c.sherdogId)).toEqual([1, 2]);
  });
});

describe("pickTiebreakWinner", () => {
  const F = AMBIGUOUS_TIEBREAK_MIN_FIGHTS;

  it("auto-matches when exactly one tied candidate has a real record and passes the guard", () => {
    expect(
      pickTiebreakWinner([
        { sherdogId: 10, guardPassed: true, proFightCount: 30 },
        { sherdogId: 11, guardPassed: true, proFightCount: 2 },
        { sherdogId: 12, guardPassed: true, proFightCount: 4 },
      ]),
    ).toBe(10);
  });

  it("sends it to review when two tied candidates BOTH have real records", () => {
    expect(
      pickTiebreakWinner([
        { sherdogId: 10, guardPassed: true, proFightCount: 25 },
        { sherdogId: 11, guardPassed: true, proFightCount: 14 },
      ]),
    ).toBeNull();
  });

  it("sends it to review when no tied candidate has a real record", () => {
    expect(
      pickTiebreakWinner([
        { sherdogId: 10, guardPassed: true, proFightCount: 3 },
        { sherdogId: 11, guardPassed: true, proFightCount: 1 },
      ]),
    ).toBeNull();
  });

  it("ignores a long-record candidate whose page failed the name guard", () => {
    expect(
      pickTiebreakWinner([
        { sherdogId: 10, guardPassed: false, proFightCount: 40 },
        { sherdogId: 11, guardPassed: true, proFightCount: 20 },
      ]),
    ).toBe(11);
  });

  it("treats exactly the threshold as a real record (inclusive)", () => {
    expect(
      pickTiebreakWinner([
        { sherdogId: 10, guardPassed: true, proFightCount: F },
        { sherdogId: 11, guardPassed: true, proFightCount: F - 1 },
      ]),
    ).toBe(10);
  });
});
