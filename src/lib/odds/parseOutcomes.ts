import { nameSimilarity } from "./similarity";
import type { FighterPrices, OddsEvent, OddsOutcome } from "./types";

const DRAW_OUTCOME_NAME = "draw";

// Lower bar than the fight-match threshold in matchFights.ts on purpose:
// by the time this runs, the fight has already been matched to this odds
// event with high confidence. This only has to choose which of the 1-2
// remaining (non-Draw) outcomes belongs to which fighter, not decide
// whether the event is about this fight at all.
const OUTCOME_MATCH_THRESHOLD = 0.5;

/**
 * Extracts this event's h2h prices for the two given fighters, discarding
 * a `Draw` outcome if one is present. Returns null rather than guessing
 * if the event has no market from the configured bookmaker, or if either
 * fighter's price can't be identified with reasonable confidence -- an
 * unpriced fight is a known, handled state; a silently wrong price is not.
 *
 * The Draw-discard exists because MMA h2h from 1xBet (the original
 * bookmaker choice) was three-outcome, verified live 2026-09-01. The
 * current bookmaker, BetOnline.ag (chosen the same day, see
 * ARCHITECTURE.md Fork 7), is a clean 2-way market with no Draw entry --
 * confirmed live on both a UFC and a DWCS fight. The filter is kept
 * anyway: it is a no-op against a 2-way market, it is already tested by
 * mutation, and removing correct, proven code for a bookmaker-specific
 * reason is not worth the churn.
 */
export function parseFighterPrices(
  event: OddsEvent,
  fighter1Name: string,
  fighter2Name: string,
): FighterPrices | null {
  const bookmaker = event.bookmakers.find((b) => b.key === "betonlineag");
  if (!bookmaker) return null;

  const market = bookmaker.markets.find((m) => m.key === "h2h");
  if (!market) return null;

  const candidates = market.outcomes.filter(
    (o) => o.name.trim().toLowerCase() !== DRAW_OUTCOME_NAME,
  );

  const fighter1Outcome = bestOutcomeMatch(candidates, fighter1Name);
  const fighter2Outcome = bestOutcomeMatch(candidates, fighter2Name);

  if (!fighter1Outcome || !fighter2Outcome) return null;
  // Both fighter names matched the SAME outcome -- genuinely ambiguous
  // (e.g. two very similar names), refuse to guess rather than silently
  // assign one price to both.
  if (fighter1Outcome === fighter2Outcome) return null;

  return {
    fighter1Price: fighter1Outcome.price,
    fighter2Price: fighter2Outcome.price,
  };
}

function bestOutcomeMatch(outcomes: OddsOutcome[], name: string): OddsOutcome | null {
  let best: OddsOutcome | null = null;
  let bestScore = 0;
  for (const outcome of outcomes) {
    const score = nameSimilarity(outcome.name, name);
    if (score > bestScore) {
      bestScore = score;
      best = outcome;
    }
  }
  return bestScore >= OUTCOME_MATCH_THRESHOLD ? best : null;
}
