import { isNoContestOrAmbiguous } from "../elo/isNoContestOrAmbiguous";

// One fight as the record derivation reads it -- deliberately the same
// four fields computeEloHistory.ts's FightForElo carries, minus the
// chronology it needs and this doesn't. A record is a count, not a
// sequence: unlike Elo, the order fights are processed in cannot change
// the answer, so an undated event is still perfectly countable here even
// though Elo has to discard it.
export interface FightForRecord {
  fighter1Id: string;
  fighter2Id: string;
  // null means void -- a draw or a No Contest, indistinguishable by this
  // column alone (the same fights.winner_id convention
  // lib/scoring/fightOutcomeFromSettledFight.ts uses for pick scoring).
  // method is what disambiguates them.
  winnerId: string | null;
  method: string | null;
}

export interface FighterRecord {
  wins: number;
  losses: number;
  draws: number;
}

/**
 * Counts every fighter's W-L-D from the fight graph.
 *
 * **This is what makes fighters.wins/losses/draws real.** Those columns
 * have existed since 0001_init_schema.sql and have never been written by
 * anything -- API-Sports does not serve a record at all (the I5 spike
 * confirmed the fighter payload has no such field), so a record has to
 * be DERIVED by counting fight history, never fetched.
 *
 * Pure and I/O-free by design, same convention as lib/scoring/ and
 * computeEloHistory.ts -- recomputeFighterRecords.ts owns fetching the
 * real rows and writing the result.
 *
 * **Every exclusion rule here is shared with Elo, not re-decided.** A
 * fighter's rating and their record are two readings of the same graph,
 * and a fight the rating discarded must not turn up on the record:
 *
 * - A No Contest, or a void with no method to tell an NC from a draw,
 *   counts as nothing at all -- via lib/elo/isNoContestOrAmbiguous.ts,
 *   the one file both callers share. I1b is the cautionary case: ten
 *   rows nearly became "fabricated draws that move ratings."
 * - A winner matching neither of the bout's own two fighters is a
 *   data-integrity problem (the Phase 47 position-collision bug), not an
 *   outcome to attribute to anyone.
 * - A bout whose two sides are the same fighter row is a fold artifact
 *   from upsertFighter's name matching, and would otherwise hand one
 *   fighter a win and a loss for a single fight.
 *
 * A fighter with no countable outcome is ABSENT from the returned map
 * rather than present at 0-0-0 -- the caller resets those to zero, and
 * "absent" keeps "we counted and found nothing" distinguishable from
 * "we never looked."
 *
 * Note the result is a record within THIS APP'S fight graph, which
 * starts around 2022 and is patchy before 2025 -- never a career
 * record. The UI is required to label it as such; see the fighter page.
 */
export function deriveFighterRecords(fights: FightForRecord[]): Map<string, FighterRecord> {
  const records = new Map<string, FighterRecord>();

  const entryFor = (fighterId: string): FighterRecord => {
    const existing = records.get(fighterId);
    if (existing) return existing;
    const fresh = { wins: 0, losses: 0, draws: 0 };
    records.set(fighterId, fresh);
    return fresh;
  };

  for (const { fighter1Id, fighter2Id, winnerId, method } of fights) {
    if (fighter1Id === fighter2Id) continue;

    if (winnerId === null) {
      if (isNoContestOrAmbiguous(method)) continue;
      entryFor(fighter1Id).draws++;
      entryFor(fighter2Id).draws++;
      continue;
    }

    if (winnerId !== fighter1Id && winnerId !== fighter2Id) continue;

    const loserId = winnerId === fighter1Id ? fighter2Id : fighter1Id;
    entryFor(winnerId).wins++;
    entryFor(loserId).losses++;
  }

  return records;
}
