export interface FightSourceState {
  wikipediaWinnerId: string | null;
  wikipediaMethod: string | null;
  wikipediaRound: number | null;
  wikipediaReportedAt: string | null;
  apiSportsWinnerId: string | null;
  apiSportsReportedAt: string | null;
}

export type SettledFrom = "both_agree" | "wikipedia_only_24h" | "api_sports_only_24h" | "wikipedia_draw_or_nc";

export type FightSettlementDecision =
  | { action: "wait" }
  | { action: "conflict" }
  | { action: "settle"; winnerId: string | null; method: string | null; round: number | null; settledFrom: SettledFrom };

// The single source of truth for ARCHITECTURE.md Fork 6's settlement
// policy. Pure and I/O-free by design (lib/scoring/'s own convention),
// so lib/settlement/settleFights.ts owns fetching the current state and
// writing the decision, and this owns only the judgment.
const SINGLE_SOURCE_TIMEOUT_HOURS = 24;

export function evaluateFightSettlement(state: FightSourceState, now: Date): FightSettlementDecision {
  const wikipediaReported = state.wikipediaReportedAt !== null;
  const apiSportsReported = state.apiSportsReportedAt !== null;

  if (!wikipediaReported && !apiSportsReported) {
    return { action: "wait" };
  }

  if (wikipediaReported && state.wikipediaWinnerId === null) {
    // A Wikipedia draw/NC. api_sports can only ever report a clear win or
    // stay silent (fetchFightHistory.ts has no "no winner" signal at
    // all), so if it's silent here there is no second opinion that will
    // ever arrive -- waiting the usual 24h buys no real confidence, so
    // this settles immediately (user-confirmed). If api_sports HAS
    // actively reported a winner, that is a genuine disagreement between
    // sources, not the "nothing to wait for" case, so it queues like any
    // other disagreement instead.
    if (apiSportsReported) {
      return { action: "conflict" };
    }
    return {
      action: "settle",
      winnerId: null,
      method: state.wikipediaMethod,
      round: state.wikipediaRound,
      settledFrom: "wikipedia_draw_or_nc",
    };
  }

  if (wikipediaReported && apiSportsReported) {
    // wikipediaWinnerId is non-null here -- the draw/NC branch above
    // already returned for the null case.
    if (state.wikipediaWinnerId === state.apiSportsWinnerId) {
      return {
        action: "settle",
        winnerId: state.wikipediaWinnerId,
        method: state.wikipediaMethod,
        round: state.wikipediaRound,
        settledFrom: "both_agree",
      };
    }
    return { action: "conflict" };
  }

  // Exactly one source has reported. Measured against THAT source's own
  // first-report timestamp, never the event's scheduled start -- a
  // delayed or postponed card must not shorten the wait.
  const soleReportedAt = wikipediaReported ? state.wikipediaReportedAt! : state.apiSportsReportedAt!;
  const hoursSinceReport = (now.getTime() - new Date(soleReportedAt).getTime()) / (1000 * 60 * 60);
  if (hoursSinceReport < SINGLE_SOURCE_TIMEOUT_HOURS) {
    return { action: "wait" };
  }

  return wikipediaReported
    ? {
        action: "settle",
        winnerId: state.wikipediaWinnerId,
        method: state.wikipediaMethod,
        round: state.wikipediaRound,
        settledFrom: "wikipedia_only_24h",
      }
    : {
        action: "settle",
        winnerId: state.apiSportsWinnerId,
        method: null,
        round: null,
        settledFrom: "api_sports_only_24h",
      };
}
