export interface SettledUserSlip {
  status: "won" | "lost" | "void" | "cashed_out";
  pnlPhp: number;
  pnlUnits: number;
  stakePhp: number;
  stakeUnits: number;
  legs: { fightId: string | null; market: string }[];
}

export interface SettledInternPick {
  fightId: string;
  pnlUnits: number | null;
  stakeUnits: number | null;
  pickCorrect: boolean | null;
}

export interface HeadToHeadPair {
  fightId: string;
  owner: { pnlPhp: number; pnlUnits: number; stakePhp: number; stakeUnits: number };
  intern: { pnlUnits: number | null; stakeUnits: number | null; pickCorrect: boolean | null };
}

// Q5's overlap comparison (ROADMAP_V2.md: "Elliott, Bukauskas, Hooker and
// Rahiki all overlap fights INTERN priced"). Restricted, deliberately, to
// slips with EXACTLY ONE leg on a MONEYLINE market:
//
//   * MONEYLINE-only -- INTERN's picks are moneyline calls (picks table
//     has no other market), so a method or double-chance leg on the same
//     fight isn't the bet INTERN is being judged against.
//   * single-leg-only -- bet_slips.pnl_php/pnl_units are SLIP-level
//     generated columns. A parlay's payout is the product of every leg;
//     there is no way to attribute a fraction of it back to just one
//     fight, so a multi-leg slip can never enter a fight-level comparison
//     without fabricating a number. (Confirmed against the real seed
//     data: the Elliott/Bukauskas/Hooker MONEYLINE bets are each their
//     own single-leg slip; the other Elliott leg sits inside a 3-leg
//     LONGSHOT parlay and is correctly excluded here.)
export function buildBettingHeadToHead(
  slips: SettledUserSlip[],
  internPicks: SettledInternPick[],
): HeadToHeadPair[] {
  const internByFightId = new Map(internPicks.map((p) => [p.fightId, p]));

  const pairs: HeadToHeadPair[] = [];
  for (const slip of slips) {
    if (slip.legs.length !== 1) continue;
    const [leg] = slip.legs;
    if (leg.market !== "MONEYLINE" || leg.fightId === null) continue;

    const internPick = internByFightId.get(leg.fightId);
    if (!internPick) continue;

    pairs.push({
      fightId: leg.fightId,
      owner: { pnlPhp: slip.pnlPhp, pnlUnits: slip.pnlUnits, stakePhp: slip.stakePhp, stakeUnits: slip.stakeUnits },
      intern: {
        pnlUnits: internPick.pnlUnits,
        stakeUnits: internPick.stakeUnits,
        pickCorrect: internPick.pickCorrect,
      },
    });
  }
  return pairs;
}
