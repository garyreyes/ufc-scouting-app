import type { SherdogHistoryFight } from "./parseFightHistory";
import { parseSherdogDate } from "./parseSherdogDate";
import { namesLikelySamePerson } from "../text/namesLikelySamePerson";

export interface KnownOpponentBout {
  opponentName: string;
  // ISO yyyy-mm-dd, from our own events.event_date.
  eventDate: string;
}

// M5: the same window used for the odds feed's own card-window matching
// (Fork 7) -- generous enough to absorb a card that moved a few days
// between the two sources' own records of it, tight enough that two
// genuinely different bouts months apart never collide.
const MAX_DAY_DIFF = 10;

function daysApart(isoA: string, isoB: string): number {
  const a = Date.parse(`${isoA}T00:00:00Z`);
  const b = Date.parse(`${isoB}T00:00:00Z`);
  return Math.abs(a - b) / 86_400_000;
}

/**
 * M5: does this Sherdog candidate's own pro fight history contain a bout
 * against one of our fighter's KNOWN opponents (from our own `fights`
 * table), within MAX_DAY_DIFF days of the date we already have for that
 * matchup? This is a strictly stronger identity signal than name
 * similarity alone -- verified live 2026-09-17 against the real
 * "Patrício Pitbull" conflict: name-similarity's own top guess
 * ("Patricio Lima", 0.59) is a namesake, but the real Bellator legend
 * ("Patricio Freire", 0.55 -- LOWER similarity) is the one whose real
 * Sherdog history actually lists our fighter's own recorded bouts
 * (vs. Aaron Pico 2026-04-11, vs. Dan Ige 2025-07-19, vs. Yair Rodríguez
 * 2025-04-12 -- all exact-date matches against our own `fights` rows).
 *
 * Also the fix for the pure nickname-storage case (our own name,
 * "Renato Moicano", is a nickname Sherdog doesn't store at all -- the
 * candidate's real name, "Renato Carneiro", never clears the name-
 * similarity threshold no matter how correct the match is). History
 * corroboration doesn't care what the name looks like; it only checks
 * whether the same career actually happened.
 */
export function historyCorroborates(
  knownBouts: KnownOpponentBout[],
  candidateHistory: SherdogHistoryFight[],
): boolean {
  for (const bout of candidateHistory) {
    const boutDate = parseSherdogDate(bout.date);
    if (!boutDate) continue;
    for (const known of knownBouts) {
      if (!namesLikelySamePerson(known.opponentName, bout.opponentName)) continue;
      if (daysApart(boutDate, known.eventDate) <= MAX_DAY_DIFF) return true;
    }
  }
  return false;
}
