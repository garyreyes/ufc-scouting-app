export interface PendingPickInput {
  author: string;
  settledAt: string | null;
  betFighterId: string | null;
  // numeric(6,2) in the DB -- the client may hand this back as a string.
  stakeUnits: number | null;
}

export interface PendingSide {
  picks: number;
  bets: number;
  unitsAtRisk: number;
}

export interface PendingSummary {
  me: PendingSide;
  intern: PendingSide;
}

/**
 * How many picks (and bets, and units) each side has riding on fights
 * that have not settled yet.
 *
 * The scoreboard's whole point is "who is more profitable," and before
 * the first card of a fresh window settles there is nothing on the
 * boards to answer that -- but the intern has usually already committed
 * to dozens of upcoming fights and staked on a handful. This surfaces
 * that so the page says something real immediately rather than an empty
 * state, and it is a count of existing rows, not a scoring computation:
 * settlement still owns pnl.
 *
 * A pick with no bet (betFighterId null) is the common case -- the
 * intern bets well under half of what it picks (edge-gated, UC-2) -- and
 * only the bets carry units at risk.
 */
export function summarizePendingPicks(picks: PendingPickInput[]): PendingSummary {
  const me: PendingSide = { picks: 0, bets: 0, unitsAtRisk: 0 };
  const intern: PendingSide = { picks: 0, bets: 0, unitsAtRisk: 0 };

  for (const pick of picks) {
    if (pick.settledAt !== null) continue;

    const side = pick.author === "USER" ? me : pick.author === "INTERN" ? intern : null;
    if (side === null) continue;

    side.picks++;
    if (pick.betFighterId !== null) {
      side.bets++;
      side.unitsAtRisk += Number(pick.stakeUnits ?? 0);
    }
  }

  return { me, intern };
}
