import { describe, expect, it } from "vitest";
import { predictInternMethod } from "./predictInternMethod";
import { FIGHT_METHODS, type FightMethod } from "../scoring/fightMethod";
import type { FinishSplit } from "./predictInternMethod";

// Real Sherdog splits, hand-verified against a live read of the database
// (2026-09-13, UFC 331 card + Fiorot/Grasso from the checkpoint). Each
// fixture's expected method was independently computed by hand (see
// DECISIONS.md) before this test was written.
const despaigne: FinishSplit = { winsKo: 6, winsSub: 0, winsDec: 0, lossesKo: 0, lossesSub: 0, lossesDec: 0 };
const tuivasa: FinishSplit = { winsKo: 13, winsSub: 0, winsDec: 1, lossesKo: 3, lossesSub: 3, lossesDec: 4 };
const jourdain: FinishSplit = { winsKo: 8, winsSub: 7, winsDec: 3, lossesKo: 1, lossesSub: 1, lossesDec: 6 };
const vera: FinishSplit = { winsKo: 8, winsSub: 10, winsDec: 5, lossesKo: 0, lossesSub: 0, lossesDec: 12 };
const fiorot: FinishSplit = { winsKo: 7, winsSub: 0, winsDec: 6, lossesKo: 0, lossesSub: 0, lossesDec: 2 };
const grasso: FinishSplit = { winsKo: 5, winsSub: 2, winsDec: 10, lossesKo: 0, lossesSub: 1, lossesDec: 4 };
// A constructed dual-threat pairing (mid bucket) -- both sides finish and
// concede finishes at a similar, even KO/sub mix, so the honest call is
// FINISH rather than guessing a side.
const dualThreatPicked: FinishSplit = { winsKo: 5, winsSub: 5, winsDec: 2, lossesKo: 0, lossesSub: 0, lossesDec: 0 };
const dualThreatOpponent: FinishSplit = { winsKo: 0, winsSub: 0, winsDec: 0, lossesKo: 4, lossesSub: 4, lossesDec: 2 };
// A constructed submission-leaning pairing (light bucket).
const subLeaningPicked: FinishSplit = { winsKo: 1, winsSub: 8, winsDec: 1, lossesKo: 0, lossesSub: 0, lossesDec: 0 };
const subLeaningOpponent: FinishSplit = { winsKo: 0, winsSub: 0, winsDec: 0, lossesKo: 1, lossesSub: 7, lossesDec: 2 };

describe("predictInternMethod -- fallback (no Sherdog data on one or both sides)", () => {
  it("is byte-identical to the weight-class-only rule when both sides are null", () => {
    expect(predictInternMethod(0.5, "Lightweight", null, null).method).toBe("DECISION");
    expect(predictInternMethod(0.8, "Heavyweight", null, null).method).toBe("KO_TKO");
    expect(predictInternMethod(0.8, "Women's Strawweight", null, null).method).toBe("SUBMISSION");
  });

  it("falls back to the weight-class-only rule when only one side has data", () => {
    // Despaigne has data, an unlinked opponent doesn't -- old rule applies,
    // never FINISH.
    expect(predictInternMethod(0.5452, "Heavyweight", despaigne, null).method).toBe("DECISION");
    expect(predictInternMethod(0.5452, "Heavyweight", null, tuivasa).method).toBe("DECISION");
  });

  it("never produces FINISH on the fallback path, across a full grid", () => {
    const weights = ["Heavyweight", "Welterweight", "Flyweight", "Women's Bantamweight", null];
    for (const w of weights) {
      for (let p = 0.5; p <= 1.0001; p += 0.02) {
        expect(predictInternMethod(p, w, null, null).method).not.toBe("FINISH");
        expect(predictInternMethod(p, w, despaigne, null).method).not.toBe("FINISH");
      }
    }
  });

  it("every non-FINISH method is reachable on the fallback path -- no dead branch", () => {
    const weights = ["Heavyweight", "Welterweight", "Flyweight", "Women's Bantamweight", null];
    const seen = new Set<FightMethod>();
    for (const w of weights) {
      for (let p = 0.5; p <= 1.0001; p += 0.01) {
        seen.add(predictInternMethod(p, w, null, null).method);
      }
    }
    expect(seen.has("DECISION")).toBe(true);
    expect(seen.has("KO_TKO")).toBe(true);
    expect(seen.has("SUBMISSION")).toBe(true);
    expect(seen.has("FINISH")).toBe(false);
  });

  // Carried over from the pre-L5 rule -- unchanged behaviour, still worth
  // pinning directly rather than only through the grid sweep above.
  it("predicts a decision for a close matchup at any weight", () => {
    expect(predictInternMethod(0.5, "Lightweight").method).toBe("DECISION");
    expect(predictInternMethod(0.52, "Heavyweight").method).toBe("DECISION");
    expect(predictInternMethod(0.53, "Women's Strawweight").method).toBe("DECISION");
  });

  it("predicts KO/TKO for a lopsided heavyweight bout", () => {
    expect(predictInternMethod(0.8, "Heavyweight").method).toBe("KO_TKO");
    expect(predictInternMethod(0.8, "Light Heavyweight").method).toBe("KO_TKO");
  });

  it("predicts a submission for a lopsided light-division bout", () => {
    expect(predictInternMethod(0.8, "Women's Strawweight").method).toBe("SUBMISSION");
    expect(predictInternMethod(0.78, "Flyweight").method).toBe("SUBMISSION");
    expect(predictInternMethod(0.8, "Bantamweight").method).toBe("SUBMISSION");
  });

  it("leans KO/TKO for a lopsided mid-division bout", () => {
    expect(predictInternMethod(0.82, "Welterweight").method).toBe("KO_TKO");
    expect(predictInternMethod(0.82, "Middleweight").method).toBe("KO_TKO");
  });

  it("lets a competitive heavyweight fight still be a decision", () => {
    expect(predictInternMethod(0.54, "Heavyweight").method).toBe("DECISION");
  });

  it("is deterministic on the fallback path -- same inputs, same output", () => {
    expect(predictInternMethod(0.77, "Middleweight")).toEqual(predictInternMethod(0.77, "Middleweight"));
  });

  it("treats an unknown or missing weight class as mid-weight without crashing", () => {
    expect(() => predictInternMethod(0.6, null)).not.toThrow();
    expect(() => predictInternMethod(0.6, "")).not.toThrow();
    expect(() => predictInternMethod(0.6, "Catchweight (165 lbs)")).not.toThrow();
    expect(predictInternMethod(0.5, null).method).toBe("DECISION");
  });

  it("does not care which side of 0.5 the probability is", () => {
    expect(predictInternMethod(0.8, "Flyweight").method).toBe(predictInternMethod(0.2, "Flyweight").method);
  });

  it("returns a human-readable note naming the method, on the fallback path", () => {
    expect(predictInternMethod(0.85, "Heavyweight").note.toLowerCase()).toContain("ko");
    expect(predictInternMethod(0.85, "Flyweight").note.toLowerCase()).toContain("submission");
    expect(predictInternMethod(0.5, "Lightweight").note.toLowerCase()).toContain("decision");
  });
});

describe("predictInternMethod -- real finish-split signal (both sides present)", () => {
  it("predicts KO/TKO when the picked fighter is a pure finisher and the opponent isn't finish-proof", () => {
    // Despaigne 6/6 wins by KO; Tuivasa concedes finishes over half the time
    // (3 KO / 3 SUB of 10 losses). Heavyweight (KO-heavy bucket) reinforces it.
    const result = predictInternMethod(0.5452, "Heavyweight", despaigne, tuivasa);
    expect(result.method).toBe("KO_TKO");
  });

  it("still predicts DECISION when the picked fighter finishes a lot but the opponent almost never gets finished", () => {
    // Jourdain finishes often (8 KO / 7 SUB of 18 wins), but Vera has NEVER
    // been finished in 12 losses (all by decision) -- the geometric-mean
    // blend lets the durable opponent veto the finish, which a simple
    // average of the two sides would not.
    const result = predictInternMethod(0.65, "Bantamweight", jourdain, vera);
    expect(result.method).toBe("DECISION");
  });

  it("no longer defaults to SUBMISSION just because the division is light", () => {
    // The bug this sub-phase exists to fix: Fiorot is 7 KO / 0 SUB, but the
    // old weight-class-only rule called a lopsided women's flyweight fight
    // SUBMISSION regardless. It must not do that once real records exist.
    const result = predictInternMethod(0.74, "Women's Flyweight", fiorot, grasso);
    expect(result.method).not.toBe("SUBMISSION");
  });

  it("predicts FINISH for an even KO/submission dual threat against a finishable opponent", () => {
    const result = predictInternMethod(0.55, "Middleweight", dualThreatPicked, dualThreatOpponent);
    expect(result.method).toBe("FINISH");
  });

  it("predicts SUBMISSION for a genuinely submission-leaning pairing", () => {
    const result = predictInternMethod(0.6, "Flyweight", subLeaningPicked, subLeaningOpponent);
    expect(result.method).toBe("SUBMISSION");
  });

  it("both KO_TKO and SUBMISSION are reachable in EVERY weight bucket, not just some -- no dead branch per bucket", () => {
    // The exact bug class RETROSPECTIVE.md already flagged once (Phase
    // 62, predictInternMethod could never return SUBMISSION at all): a
    // reviewer pass found a straight 50/50 blend of the weight-class KO
    // share with the fighters' own record made SUBMISSION mathematically
    // unreachable specifically in the heavy bucket (KO_SHARE.heavy = 0.85
    // means even a pure-submission record on both sides couldn't pull the
    // blend below the 0.35 cutoff). This brute-forces a near-pure KO
    // pairing and a near-pure submission pairing in each bucket, so a
    // regression to that class of bug fails loudly here instead of only
    // showing up as an absent value in a live backtest's call
    // distribution.
    // n = 50 -- large enough that shrinkage (K = 8) no longer masks a pure
    // record: at 50 pure-submission wins/losses in the heavy bucket (the
    // hardest case, KO_SHARE.heavy = 0.85), the shrunk KO-within-finish
    // share is ~0.063, comfortably under the 0.35 cutoff after blending.
    const pureKo: FinishSplit = { winsKo: 50, winsSub: 0, winsDec: 0, lossesKo: 50, lossesSub: 0, lossesDec: 0 };
    const pureSub: FinishSplit = { winsKo: 0, winsSub: 50, winsDec: 0, lossesKo: 0, lossesSub: 50, lossesDec: 0 };
    const buckets = ["Heavyweight", "Middleweight", "Flyweight"];
    for (const w of buckets) {
      expect(predictInternMethod(0.6, w, pureKo, pureKo).method).toBe("KO_TKO");
      expect(predictInternMethod(0.6, w, pureSub, pureSub).method).toBe("SUBMISSION");
    }
  });

  it("every method including FINISH is reachable once both sides carry data -- no dead branch", () => {
    const cases: Array<[number, string, FinishSplit, FinishSplit]> = [
      [0.5452, "Heavyweight", despaigne, tuivasa],
      [0.65, "Bantamweight", jourdain, vera],
      [0.55, "Middleweight", dualThreatPicked, dualThreatOpponent],
      [0.6, "Flyweight", subLeaningPicked, subLeaningOpponent],
    ];
    const seen = new Set<FightMethod>();
    for (const [p, w, picked, opponent] of cases) {
      seen.add(predictInternMethod(p, w, picked, opponent).method);
    }
    for (const m of FIGHT_METHODS) {
      expect(seen.has(m)).toBe(true);
    }
  });

  it("does not divide by zero for a fighter with no recorded wins or losses", () => {
    const empty: FinishSplit = { winsKo: 0, winsSub: 0, winsDec: 0, lossesKo: 0, lossesSub: 0, lossesDec: 0 };
    expect(() => predictInternMethod(0.6, "Lightweight", empty, empty)).not.toThrow();
  });

  it("is deterministic -- same inputs, same output", () => {
    expect(predictInternMethod(0.5452, "Heavyweight", despaigne, tuivasa)).toEqual(
      predictInternMethod(0.5452, "Heavyweight", despaigne, tuivasa),
    );
  });

  it("returns a human-readable note naming the fighters' own records", () => {
    const result = predictInternMethod(0.5452, "Heavyweight", despaigne, tuivasa);
    expect(result.note.toLowerCase()).toContain("ko");
  });
});
