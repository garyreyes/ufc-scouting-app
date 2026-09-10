export interface SherdogBoutForMatch {
  fighter_id: string;
  opponent_sherdog_id: number | null;
  result: "win" | "loss" | "draw" | "nc" | "unknown";
  event_date: string | null;
  method: string | null;
  round: number | null;
}

export interface FightForSherdogMatch {
  fighter1_id: string;
  fighter1_sherdog_id: number | null;
  fighter2_id: string;
  fighter2_sherdog_id: number | null;
  event_date: string;
}

export type SherdogResultMatch =
  | { status: "no_data" }
  | { status: "ambiguous"; reason: string }
  | {
      status: "matched";
      winnerId: string | null; // fighter1_id | fighter2_id | null (draw / nc)
      method: string | null;
      round: number | null;
      // Both fighters' Sherdog pages independently reported this bout and
      // agree on the outcome. applySherdogResults.ts requires this before
      // Sherdog is allowed to settle a fight ALONE (sherdog_only_12h) --
      // a one-sided match still corroborates or breaks a tie, but is not
      // trusted as the only source.
      bilateral: boolean;
    };

const DEFAULT_MAX_DATE_SKEW_DAYS = 10;

/**
 * J7: reads a settled/pending `fights` row against the Sherdog history
 * sidecar (`fighter_sherdog_bouts`) and says who Sherdog thinks won.
 *
 * Match key is `opponent_sherdog_id` (a real id parsed off the opponent
 * link, not a name) plus an event-date window -- Sherdog's printed date
 * and the app's `events.event_date` can differ by a day or two across
 * time zones and "card date vs broadcast date". A bout with no date, or
 * outside the window, is not a candidate: without it a rematch can't be
 * told from the first meeting, and a wrong-bout match would settle picks
 * against the wrong result.
 *
 * Conservative on purpose -- anything unclear returns `ambiguous` or
 * `no_data` (Sherdog simply doesn't contribute), never a guessed winner:
 *   - either fighter not Sherdog-linked -> no_data
 *   - no in-window bout on either page -> no_data
 *   - >1 in-window bout vs the same opponent (rematch) -> ambiguous
 *   - both pages report it but disagree on the winner -> ambiguous
 *   - the only bout on record has result "unknown" -> ambiguous
 */
export function matchSherdogFightResult(
  fight: FightForSherdogMatch,
  bouts: SherdogBoutForMatch[],
  maxDateSkewDays: number = DEFAULT_MAX_DATE_SKEW_DAYS,
): SherdogResultMatch {
  if (fight.fighter1_sherdog_id === null || fight.fighter2_sherdog_id === null) {
    return { status: "no_data" };
  }

  const eventTime = new Date(fight.event_date).getTime();
  const inWindow = (boutDate: string | null): boolean => {
    if (boutDate === null) return false;
    const skewDays = Math.abs(new Date(boutDate).getTime() - eventTime) / (1000 * 60 * 60 * 24);
    return skewDays <= maxDateSkewDays;
  };

  const candidatesFor = (selfId: string, opponentSherdogId: number) =>
    bouts.filter(
      (b) =>
        b.fighter_id === selfId &&
        b.opponent_sherdog_id === opponentSherdogId &&
        inWindow(b.event_date),
    );

  const f1Candidates = candidatesFor(fight.fighter1_id, fight.fighter2_sherdog_id);
  const f2Candidates = candidatesFor(fight.fighter2_id, fight.fighter1_sherdog_id);

  if (f1Candidates.length > 1 || f2Candidates.length > 1) {
    return { status: "ambiguous", reason: "multiple in-window bouts vs the same opponent (rematch?)" };
  }
  if (f1Candidates.length === 0 && f2Candidates.length === 0) {
    return { status: "no_data" };
  }

  const f1Bout = f1Candidates[0];
  const f2Bout = f2Candidates[0];

  // Winner id implied by one page's row. `undefined` = "unknown" result,
  // i.e. no signal from that page; `null` = an actual draw / no-contest.
  const winnerFrom = (
    bout: SherdogBoutForMatch | undefined,
    selfId: string,
    opponentId: string,
  ): string | null | undefined => {
    if (!bout) return undefined;
    switch (bout.result) {
      case "win":
        return selfId;
      case "loss":
        return opponentId;
      case "draw":
      case "nc":
        return null;
      default:
        return undefined;
    }
  };

  const w1 = winnerFrom(f1Bout, fight.fighter1_id, fight.fighter2_id);
  const w2 = winnerFrom(f2Bout, fight.fighter2_id, fight.fighter1_id);

  if (w1 !== undefined && w2 !== undefined) {
    if (w1 !== w2) {
      return { status: "ambiguous", reason: "the two fighters' Sherdog pages disagree on the winner" };
    }
    return {
      status: "matched",
      winnerId: w1,
      method: f1Bout?.method ?? f2Bout?.method ?? null,
      round: f1Bout?.round ?? f2Bout?.round ?? null,
      bilateral: true,
    };
  }

  const sole = w1 !== undefined ? w1 : w2;
  if (sole === undefined) {
    return { status: "ambiguous", reason: "result unknown on the only page that lists the bout" };
  }

  const soleBout = w1 !== undefined ? f1Bout : f2Bout;
  const otherBout = w1 !== undefined ? f2Bout : f1Bout;
  return {
    status: "matched",
    winnerId: sole,
    method: soleBout?.method ?? otherBout?.method ?? null,
    round: soleBout?.round ?? otherBout?.round ?? null,
    bilateral: false,
  };
}
