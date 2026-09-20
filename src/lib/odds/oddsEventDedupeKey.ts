import { normalizeName } from "../text/normalizeName";
import type { OddsEvent } from "./types";

/**
 * D4 (ROADMAP_V2.md Phase P): a stable identity for "this bout," used to
 * dedup low_confidence_odds_match rows instead of the feed's own
 * oddsEvent.id. The raw id is NOT a stable bout identifier -- the feed
 * re-emitted the same bout under a new id with a spelling variant
 * ("Łukasz Charzewski" vs "Lukasz Charzewski"), and dedup keyed on the raw
 * id let both file separately.
 *
 * Reuses normalizeName (the same fold matching itself already applies) so
 * a spelling/punctuation variant collapses onto the same key. Sorts the
 * two names so a home/away swap between re-emissions doesn't produce a
 * different key. Truncates commence_time to the calendar date so a same-
 * day correction to the exact kickoff time doesn't split one bout into two
 * keys -- a genuinely different date is a different card, not a
 * correction.
 */
export function buildOddsEventDedupeKey(oddsEvent: OddsEvent): string {
  const names = [normalizeName(oddsEvent.home_team), normalizeName(oddsEvent.away_team)].sort();
  const date = oddsEvent.commence_time.slice(0, 10);
  return `${names.join("|")}::${date}`;
}
