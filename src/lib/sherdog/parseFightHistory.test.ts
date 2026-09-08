import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFightHistory, type SherdogFightResult } from "./parseFightHistory";

const fx = (n: string) => readFileSync(join(__dirname, "__fixtures__", n), "utf-8");
const OLIVEIRA = fx("fighter-oliveira-30300.html");
const MAKHACHEV = fx("fighter-makhachev-76836.html");
const QILENG = fx("fighter-qileng-aori-222519.html");
const LETOI = fx("fighter-letoi-345261.html");

describe("parseFightHistory — shape and completeness", () => {
  it("Oliveira: 49 pro bouts, newest first", () => {
    const h = parseFightHistory(OLIVEIRA);
    expect(h).toHaveLength(49);
    expect(h[0]).toEqual({
      result: "win",
      opponentName: "Max Holloway",
      opponentSherdogId: 38671,
      eventName: "UFC 326 - Holloway vs. Oliveira 2",
      eventSherdogId: 110782,
      date: "Mar / 07 / 2026",
      method: "Decision (Unanimous)",
      referee: "Marc Goddard",
      round: 5,
      time: "5:00",
    });
  });

  it("Oliveira: the oldest bout is the 2008 debut, referee unlisted", () => {
    const h = parseFightHistory(OLIVEIRA);
    expect(h[h.length - 1]).toMatchObject({
      opponentName: "Jakson Pontes",
      opponentSherdogId: 30302,
      date: "Mar / 15 / 2008",
      method: "Submission (Rear-Naked Choke)",
      referee: null,
      round: 1,
    });
  });

  it("method, round, opponent id and date are present on EVERY row of every fixture", () => {
    for (const html of [OLIVEIRA, MAKHACHEV, QILENG, LETOI]) {
      const h = parseFightHistory(html);
      expect(h.length).toBeGreaterThan(0);
      for (const f of h) {
        expect(f.method, JSON.stringify(f)).toBeTruthy();
        expect(f.round, JSON.stringify(f)).not.toBeNull();
        expect(f.opponentSherdogId, JSON.stringify(f)).not.toBeNull();
        expect(f.opponentName, JSON.stringify(f)).toBeTruthy();
        expect(f.date, JSON.stringify(f)).toBeTruthy();
      }
    }
  });

  it("event id is null on old regional shows but the event name still parses", () => {
    // Sherdog's event DB does not cover every regional card; the spike
    // saw this on ~1/3 of Oliveira's early bouts. Name must survive it.
    const h = parseFightHistory(OLIVEIRA);
    const noEventId = h.filter((f) => f.eventSherdogId === null);
    // (may be zero on a given re-pull; assert the invariant, not a count)
    for (const f of noEventId) expect(f.eventName).toBeTruthy();
  });

  it("Letoi: a single-bout career parses to exactly one row", () => {
    expect(parseFightHistory(LETOI)).toHaveLength(1);
  });
});

describe("parseFightHistory — result enum reachability", () => {
  it("'win', 'loss' and 'nc' all occur across the real fixtures", () => {
    const seen = new Set<SherdogFightResult>();
    for (const html of [OLIVEIRA, MAKHACHEV, QILENG])
      for (const f of parseFightHistory(html)) seen.add(f.result);
    expect(seen.has("win")).toBe(true);
    expect(seen.has("loss")).toBe(true);
    expect(seen.has("nc")).toBe(true);
  });

  it("maps a 'draw' result class to 'draw'", () => {
    const row = synthRow("draw", "Draw", "Someone-Drawn-999");
    expect(parseFightHistory(row)[0].result).toBe("draw");
  });

  it("maps an unrecognised result class to 'unknown' rather than dropping the row", () => {
    const row = synthRow("dq_or_something", "?", "Odd-Case-111");
    expect(parseFightHistory(row)[0].result).toBe("unknown");
  });
});

// Minimal real-shaped table with one data row, for the enum values the
// saved fixtures don't happen to contain.
function synthRow(resultClass: string, resultText: string, oppSlug: string): string {
  return `
    <div class="module fight_history">
      <table class="new_table fighter">
        <tr class="table_head"><td>Result</td></tr>
        <tr>
          <td><span class="final_result ${resultClass}">${resultText}</span></td>
          <td><a href="/fighter/${oppSlug}">Opponent</a></td>
          <td><a href="/events/Some-Event-42"><span itemprop="award">Some Event</span></a><br />
              <span class="sub_line">Jan / 01 / 2020</span></td>
          <td class="winby"><b>Decision (Split)</b><br /><span class="sub_line"></span></td>
          <td>3</td>
          <td>5:00</td>
        </tr>
      </table>
    </section>`;
}
