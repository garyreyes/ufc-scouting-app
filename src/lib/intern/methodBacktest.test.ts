import { describe, expect, it } from "vitest";
import {
  buildBacktestCase,
  buildCareerTimeline,
  classifySherdogMethod,
  splitBeforeDate,
  summarizeBacktest,
  type SherdogBoutRecord,
} from "./methodBacktest";

describe("classifySherdogMethod", () => {
  it("classifies every real method head found live in fighter_sherdog_bouts", () => {
    expect(classifySherdogMethod("Decision (Unanimous)")).toBe("DECISION");
    expect(classifySherdogMethod("Decision (Split) (29-28, 28-29, 29-28)")).toBe("DECISION");
    expect(classifySherdogMethod("TKO (Punches)")).toBe("KO_TKO");
    expect(classifySherdogMethod("KO (Punch)")).toBe("KO_TKO");
    expect(classifySherdogMethod("Submission (Rear-Naked Choke)")).toBe("SUBMISSION");
    expect(classifySherdogMethod("Technical Submission (Rear-Naked Choke)")).toBe("SUBMISSION");
    expect(classifySherdogMethod("Technical Decision (Unanimous)")).toBe("DECISION");
  });

  it("returns null for a draw, no contest, disqualification, or unknown text", () => {
    expect(classifySherdogMethod("Draw (Majority)")).toBeNull();
    expect(classifySherdogMethod("No Contest")).toBeNull();
    expect(classifySherdogMethod("Disqualification (Illegal Elbows)")).toBeNull();
    expect(classifySherdogMethod(null)).toBeNull();
    expect(classifySherdogMethod("")).toBeNull();
  });
});

describe("buildCareerTimeline", () => {
  it("accumulates a running split strictly BEFORE each bout, never including it", () => {
    const bouts: SherdogBoutRecord[] = [
      { eventDate: "2020-01-01", opponentSherdogId: 1, result: "win", method: "KO (Punch)" },
      { eventDate: "2021-01-01", opponentSherdogId: 2, result: "win", method: "Submission (Armbar)" },
      { eventDate: "2022-01-01", opponentSherdogId: 3, result: "loss", method: "Decision (Unanimous)" },
    ];
    const timeline = buildCareerTimeline(bouts);
    expect(timeline).toHaveLength(3);
    expect(timeline[0].splitBefore).toEqual({
      winsKo: 0,
      winsSub: 0,
      winsDec: 0,
      lossesKo: 0,
      lossesSub: 0,
      lossesDec: 0,
    });
    // Before the 3rd bout, the fighter has 1 KO win + 1 sub win recorded --
    // NOT the 3rd bout's own loss.
    expect(timeline[2].splitBefore).toEqual({
      winsKo: 1,
      winsSub: 1,
      winsDec: 0,
      lossesKo: 0,
      lossesSub: 0,
      lossesDec: 0,
    });
  });

  it("sorts out-of-order input into chronological order", () => {
    const bouts: SherdogBoutRecord[] = [
      { eventDate: "2022-01-01", opponentSherdogId: 1, result: "win", method: "KO (Punch)" },
      { eventDate: "2020-01-01", opponentSherdogId: 2, result: "win", method: "Submission (Armbar)" },
    ];
    const timeline = buildCareerTimeline(bouts);
    expect(timeline[0].eventDate).toBe("2020-01-01");
    expect(timeline[1].eventDate).toBe("2022-01-01");
  });

  it("drops bouts with no date, a draw/NC/DQ result, or an unclassifiable method -- and they don't advance the running split", () => {
    const bouts: SherdogBoutRecord[] = [
      { eventDate: null, opponentSherdogId: 1, result: "win", method: "KO (Punch)" },
      { eventDate: "2020-01-01", opponentSherdogId: 2, result: "draw", method: "Draw (Majority)" },
      { eventDate: "2021-01-01", opponentSherdogId: 3, result: "win", method: "Decision (Unanimous)" },
    ];
    const timeline = buildCareerTimeline(bouts);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].eventDate).toBe("2021-01-01");
    expect(timeline[0].splitBefore).toEqual({
      winsKo: 0,
      winsSub: 0,
      winsDec: 0,
      lossesKo: 0,
      lossesSub: 0,
      lossesDec: 0,
    });
  });
});

describe("splitBeforeDate", () => {
  it("returns the opponent's own record accumulated strictly before the given date", () => {
    const opponentBouts: SherdogBoutRecord[] = [
      { eventDate: "2019-01-01", opponentSherdogId: 9, result: "loss", method: "KO (Punch)" },
      { eventDate: "2020-01-01", opponentSherdogId: 9, result: "loss", method: "Submission (Armbar)" },
      { eventDate: "2023-01-01", opponentSherdogId: 9, result: "win", method: "Decision (Unanimous)" },
    ];
    const timeline = buildCareerTimeline(opponentBouts);
    const split = splitBeforeDate(timeline, "2021-01-01");
    // The 2023 win must NOT be counted -- it's after 2021.
    expect(split).toEqual({ winsKo: 0, winsSub: 0, winsDec: 0, lossesKo: 1, lossesSub: 1, lossesDec: 0 });
  });

  it("returns an all-zero split when the opponent has bouts but none before the date", () => {
    const timeline = buildCareerTimeline([
      { eventDate: "2025-01-01", opponentSherdogId: 1, result: "win", method: "KO (Punch)" },
    ]);
    expect(splitBeforeDate(timeline, "2020-01-01")).toEqual({
      winsKo: 0,
      winsSub: 0,
      winsDec: 0,
      lossesKo: 0,
      lossesSub: 0,
      lossesDec: 0,
    });
  });

  it("returns null when the opponent has no timeline at all -- not a linked fighter", () => {
    expect(splitBeforeDate([], "2020-01-01")).toBeNull();
  });
});

describe("buildBacktestCase + summarizeBacktest", () => {
  it("marks bothSidesAvailable false and matches the fallback rule when the opponent split is null", () => {
    const timeline = buildCareerTimeline([
      { eventDate: "2024-01-01", opponentSherdogId: 5, result: "win", method: "KO (Punch)" },
    ]);
    const c = buildBacktestCase(timeline[0], "Heavyweight", null);
    expect(c.bothSidesAvailable).toBe(false);
    expect(c.newRule).toBe(c.oldRule);
  });

  it("summarizes a small backtest without dividing by zero when a bucket is empty", () => {
    const summary = summarizeBacktest([]);
    expect(summary.totalCases).toBe(0);
    expect(summary.oldRuleAccuracy).toBe(0);
    expect(summary.finishHitRate).toBe(0);
  });

  it("computes finish call rate and hit rate only over bothSidesCases, excluding fallback-only cases", () => {
    const summary = summarizeBacktest([
      { actual: "KO_TKO", oldRule: "DECISION", newRule: "FINISH", bothSidesAvailable: true },
      { actual: "DECISION", oldRule: "DECISION", newRule: "DECISION", bothSidesAvailable: true },
      { actual: "KO_TKO", oldRule: "KO_TKO", newRule: "KO_TKO", bothSidesAvailable: false },
    ]);
    expect(summary.totalCases).toBe(3);
    expect(summary.bothSidesCases).toBe(2);
    expect(summary.finishCallRate).toBeCloseTo(0.5);
    expect(summary.finishHitRate).toBeCloseTo(1); // the one FINISH call was actually a KO
    // exact calls exclude the FINISH one -- only the DECISION case counts,
    // and it's correct.
    expect(summary.newRuleExactCalls).toBe(1);
    expect(summary.newRuleExactAccuracy).toBeCloseTo(1);
    // Old rule got the KO_TKO-actual/FINISH-called case wrong (called
    // DECISION) and the DECISION case right -- 1/2 over the SAME
    // both-sides population the new rule is measured over.
    expect(summary.oldRuleAccuracyBothSides).toBeCloseTo(0.5);
  });
});
