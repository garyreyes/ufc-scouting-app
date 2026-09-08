import type { SherdogFinishBreakdown, SherdogHeadlineRecord } from "./parseFighterPage";
import type { SherdogFightResult, SherdogHistoryFight } from "./parseFightHistory";
import { parseSherdogDate } from "./parseSherdogDate";

// One row as fighter_sherdog_bouts stores it (0038). No foreign keys to
// opponents or events -- those stay as Sherdog's own id + name text.
export interface SherdogBoutRow {
  bout_order: number;
  result: SherdogFightResult;
  opponent_sherdog_id: number | null;
  opponent_name: string;
  event_sherdog_id: number | null;
  event_name: string | null;
  event_date: string | null;
  method: string | null;
  referee: string | null;
  round: number | null;
  bout_time: string | null;
}

export interface SherdogFinishUpdate {
  sherdog_wins_by_ko: number;
  sherdog_wins_by_sub: number;
  sherdog_wins_by_dec: number;
  sherdog_losses_by_ko: number;
  sherdog_losses_by_sub: number;
  sherdog_losses_by_dec: number;
}

export type BuildBoutRowsResult =
  | { ok: false; reason: string }
  // `finish` null means Sherdog's own finish breakdown didn't add up to
  // its own headline record -- the bouts are still trustworthy, the
  // 6 finish columns get written null rather than wrong.
  | { ok: true; bouts: SherdogBoutRow[]; finish: SherdogFinishUpdate | null };

function countResults(history: SherdogHistoryFight[]): Record<SherdogFightResult, number> {
  const c: Record<SherdogFightResult, number> = { win: 0, loss: 0, draw: 0, nc: 0, unknown: 0 };
  for (const f of history) c[f.result]++;
  return c;
}

/**
 * Turns a fighter's parsed Sherdog page into the rows the import job
 * writes -- AND refuses to, if the page doesn't check out against
 * itself. J5 makes Sherdog's headline number the fighter's record, so a
 * page whose history table doesn't reconcile with that headline is not
 * something to half-import; the job skips the fighter, logs, and leaves
 * them for a later run.
 *
 * Reject when:
 *  - the headline shows fights but the history table is empty (a parse
 *    failure, not a real fighter with no record);
 *  - any bout's result class didn't parse ('unknown');
 *  - counted W / L / D / NC don't each equal the headline.
 */
export function buildSherdogBoutRows(
  history: SherdogHistoryFight[],
  finish: SherdogFinishBreakdown,
  headline: SherdogHeadlineRecord,
): BuildBoutRowsResult {
  const headlineTotal = headline.wins + headline.losses + headline.draws + headline.noContests;

  if (history.length === 0) {
    if (headlineTotal > 0) {
      return {
        ok: false,
        reason: `Sherdog shows a ${headline.wins}-${headline.losses} record but the history table is empty`,
      };
    }
    return { ok: true, bouts: [], finish: zeroIfClean(finish, headline) };
  }

  const counted = countResults(history);
  if (counted.unknown > 0) {
    return { ok: false, reason: `${counted.unknown} bout(s) have an unparsed result class` };
  }
  if (
    counted.win !== headline.wins ||
    counted.loss !== headline.losses ||
    counted.draw !== headline.draws ||
    counted.nc !== headline.noContests
  ) {
    return {
      ok: false,
      reason:
        `headline ${headline.wins}-${headline.losses}-${headline.draws} (${headline.noContests} NC) ` +
        `disagrees with counted ${counted.win}-${counted.loss}-${counted.draw} (${counted.nc} NC)`,
    };
  }

  const bouts: SherdogBoutRow[] = history.map((f, i) => ({
    bout_order: i,
    result: f.result,
    opponent_sherdog_id: f.opponentSherdogId,
    opponent_name: f.opponentName,
    event_sherdog_id: f.eventSherdogId,
    event_name: f.eventName,
    event_date: parseSherdogDate(f.date),
    method: f.method,
    referee: f.referee,
    round: f.round,
    bout_time: f.time,
  }));

  return { ok: true, bouts, finish: zeroIfClean(finish, headline) };
}

// The finish breakdown is a soft signal for predictInternMethod, so a
// mismatch here doesn't reject the whole import -- it just means the 6
// columns are written null. Returns the update only when both the wins
// and the losses sides sum to the headline.
function zeroIfClean(
  finish: SherdogFinishBreakdown,
  headline: SherdogHeadlineRecord,
): SherdogFinishUpdate | null {
  const winSum = finish.winsByKo + finish.winsBySub + finish.winsByDecision;
  const lossSum = finish.lossesByKo + finish.lossesBySub + finish.lossesByDecision;
  if (winSum !== headline.wins || lossSum !== headline.losses) return null;
  return {
    sherdog_wins_by_ko: finish.winsByKo,
    sherdog_wins_by_sub: finish.winsBySub,
    sherdog_wins_by_dec: finish.winsByDecision,
    sherdog_losses_by_ko: finish.lossesByKo,
    sherdog_losses_by_sub: finish.lossesBySub,
    sherdog_losses_by_dec: finish.lossesByDecision,
  };
}
