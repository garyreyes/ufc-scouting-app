import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSherdogBoutRows } from "./buildSherdogBoutRows";
import { parseFinishBreakdown, parseHeadlineRecord } from "./parseFighterPage";
import { parseFightHistory, type SherdogHistoryFight } from "./parseFightHistory";
import type { SherdogFinishBreakdown, SherdogHeadlineRecord } from "./parseFighterPage";

const fx = (n: string) => readFileSync(join(__dirname, "__fixtures__", n), "utf-8");

const emptyFinish: SherdogFinishBreakdown = {
  winsByKo: 0,
  winsBySub: 0,
  winsByDecision: 0,
  lossesByKo: 0,
  lossesBySub: 0,
  lossesByDecision: 0,
};

function bout(over: Partial<SherdogHistoryFight> & { result: SherdogHistoryFight["result"] }): SherdogHistoryFight {
  return {
    opponentName: "Someone",
    opponentSherdogId: 1,
    eventName: "Event",
    eventSherdogId: 2,
    date: "Jan / 01 / 2020",
    method: "Decision (Unanimous)",
    referee: null,
    round: 3,
    time: "5:00",
    ...over,
  };
}

describe("buildSherdogBoutRows — real fixtures round-trip", () => {
  it.each([
    ["Oliveira", "fighter-oliveira-30300.html", 49],
    ["Makhachev", "fighter-makhachev-76836.html", 30],
    ["Letoi", "fighter-letoi-345261.html", 1],
  ])("%s: builds one row per bout, newest = bout_order 0, dates parsed", (_n, file, count) => {
    const html = fx(file);
    const res = buildSherdogBoutRows(
      parseFightHistory(html),
      parseFinishBreakdown(html),
      parseHeadlineRecord(html),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.bouts).toHaveLength(count);
    expect(res.bouts[0].bout_order).toBe(0);
    expect(res.bouts[count - 1].bout_order).toBe(count - 1);
    // every fixture row has a date, so every built row has an ISO date
    for (const b of res.bouts) expect(b.event_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("Oliveira: the newest bout maps every field", () => {
    const html = fx("fighter-oliveira-30300.html");
    const res = buildSherdogBoutRows(
      parseFightHistory(html),
      parseFinishBreakdown(html),
      parseHeadlineRecord(html),
    );
    if (!res.ok) throw new Error("expected ok");
    expect(res.bouts[0]).toEqual({
      bout_order: 0,
      result: "win",
      opponent_sherdog_id: 38671,
      opponent_name: "Max Holloway",
      event_sherdog_id: 110782,
      event_name: "UFC 326 - Holloway vs. Oliveira 2",
      event_date: "2026-03-07",
      method: "Decision (Unanimous)",
      referee: "Marc Goddard",
      round: 5,
      bout_time: "5:00",
    });
  });

  it("Oliveira: the finish breakdown reconciles and is returned", () => {
    const html = fx("fighter-oliveira-30300.html");
    const res = buildSherdogBoutRows(
      parseFightHistory(html),
      parseFinishBreakdown(html),
      parseHeadlineRecord(html),
    );
    if (!res.ok) throw new Error("expected ok");
    expect(res.finish).toEqual({
      sherdog_wins_by_ko: 10,
      sherdog_wins_by_sub: 22,
      sherdog_wins_by_dec: 5,
      sherdog_losses_by_ko: 5,
      sherdog_losses_by_sub: 4,
      sherdog_losses_by_dec: 2,
    });
  });
});

describe("buildSherdogBoutRows — cross-checks (skip rather than write half-data)", () => {
  const headline = (w: number, l: number, d = 0, nc = 0): SherdogHeadlineRecord => ({
    wins: w,
    losses: l,
    draws: d,
    noContests: nc,
  });

  it("fails when the headline shows a record but the history table is empty", () => {
    const res = buildSherdogBoutRows([], emptyFinish, headline(12, 3));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/empty/i);
  });

  it("is ok with a genuinely fightless fighter (0-0, no rows)", () => {
    const res = buildSherdogBoutRows([], emptyFinish, headline(0, 0));
    expect(res.ok).toBe(true);
  });

  it("fails when counted wins/losses disagree with the headline", () => {
    const history = [bout({ result: "win" }), bout({ result: "win" }), bout({ result: "loss" })];
    const res = buildSherdogBoutRows(history, emptyFinish, headline(5, 1));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/headline|counted/i);
  });

  it("fails when any row's result did not parse (unknown)", () => {
    const history = [bout({ result: "win" }), bout({ result: "unknown" })];
    const res = buildSherdogBoutRows(history, emptyFinish, headline(1, 0, 0, 0));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/unknown|parse/i);
  });

  it("succeeds on a matching win/loss/draw/nc count", () => {
    const history = [
      bout({ result: "win" }),
      bout({ result: "loss" }),
      bout({ result: "draw" }),
      bout({ result: "nc" }),
    ];
    const res = buildSherdogBoutRows(history, emptyFinish, headline(1, 1, 1, 1));
    expect(res.ok).toBe(true);
  });

  it("keeps the bouts but nulls the finish breakdown when it doesn't reconcile", () => {
    const history = [bout({ result: "win" }), bout({ result: "win" })];
    // headline says 2-0, but the finish breakdown only accounts for 1 win
    const badFinish: SherdogFinishBreakdown = { ...emptyFinish, winsByKo: 1 };
    const res = buildSherdogBoutRows(history, badFinish, headline(2, 0));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.finish).toBeNull();
  });
});
