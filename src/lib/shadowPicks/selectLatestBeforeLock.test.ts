import { describe, expect, it } from "vitest";
import { selectLatestBeforeLock } from "./selectLatestBeforeLock";
import type { ShadowPickScoringRow } from "./selectLatestBeforeLock";

const FIGHT_1 = "fight-1";
const FIGHT_2 = "fight-2";
const FIGHTER_A = "fighter-a";

function row(overrides: Partial<ShadowPickScoringRow>): ShadowPickScoringRow {
  return {
    fightId: FIGHT_1,
    line: "LLM_ASSISTED",
    predictedFighterId: FIGHTER_A,
    probability: 0.6,
    confidence: 3,
    createdAtMs: 0,
    ...overrides,
  };
}

describe("selectLatestBeforeLock", () => {
  it("picks the latest row strictly before lock when several exist", () => {
    const lockAtMsByFightId = new Map([[FIGHT_1, 1000]]);
    const rows = [row({ createdAtMs: 100, probability: 0.5 }), row({ createdAtMs: 500, probability: 0.7 })];

    const result = selectLatestBeforeLock(rows, lockAtMsByFightId);

    expect(result).toHaveLength(1);
    expect(result[0].probability).toBe(0.7);
  });

  it("excludes a row created exactly at or after lock time -- N9 must never leak post-lock information", () => {
    const lockAtMsByFightId = new Map([[FIGHT_1, 1000]]);
    const rows = [row({ createdAtMs: 500, probability: 0.5 }), row({ createdAtMs: 1000, probability: 0.99 })];

    const result = selectLatestBeforeLock(rows, lockAtMsByFightId);

    expect(result).toHaveLength(1);
    expect(result[0].probability).toBe(0.5);
  });

  it("drops a fight with no known lock time entirely -- nothing to measure it against", () => {
    const lockAtMsByFightId = new Map<string, number>();
    const rows = [row({ createdAtMs: 100 })];

    expect(selectLatestBeforeLock(rows, lockAtMsByFightId)).toEqual([]);
  });

  it("tracks LLM_ASSISTED and LLM_ONLY independently for the same fight", () => {
    const lockAtMsByFightId = new Map([[FIGHT_1, 1000]]);
    const rows = [
      row({ line: "LLM_ASSISTED", createdAtMs: 200, probability: 0.6 }),
      row({ line: "LLM_ONLY", createdAtMs: 900, probability: 0.8 }),
    ];

    const result = selectLatestBeforeLock(rows, lockAtMsByFightId);

    expect(result).toHaveLength(2);
    const byLine = new Map(result.map((r) => [r.line, r]));
    expect(byLine.get("LLM_ASSISTED")?.probability).toBe(0.6);
    expect(byLine.get("LLM_ONLY")?.probability).toBe(0.8);
  });

  it("tracks each fight independently", () => {
    const lockAtMsByFightId = new Map([
      [FIGHT_1, 1000],
      [FIGHT_2, 2000],
    ]);
    const rows = [
      row({ fightId: FIGHT_1, createdAtMs: 100, probability: 0.4 }),
      row({ fightId: FIGHT_2, createdAtMs: 1500, probability: 0.9 }),
    ];

    const result = selectLatestBeforeLock(rows, lockAtMsByFightId);

    expect(result).toHaveLength(2);
  });

  it("returns [] on no input", () => {
    expect(selectLatestBeforeLock([], new Map())).toEqual([]);
  });
});
