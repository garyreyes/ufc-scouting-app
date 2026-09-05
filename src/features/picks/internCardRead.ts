import { devigTwoWay } from "@/lib/scoring/devigTwoWay";
import { probabilityForFighter } from "@/lib/scoring/probabilityForFighter";
import { edge } from "@/lib/scoring/edge";
import type { FightMethod } from "@/lib/scoring/fightMethod";
import type { InternPickSummary } from "./types";

interface CardFight {
  id: string;
  fighter1: { id: string; name: string };
  fighter2: { id: string; name: string };
  odds: { fighter1_price: number; fighter2_price: number } | null;
}

export interface InternCardReadRow {
  fightId: string;
  fighter1Name: string;
  fighter2Name: string;
  pickName: string;
  method: FightMethod | null;
  // Which fighter the intern staked on, and how much -- null when it
  // made a pick but declined the bet (the common case).
  betName: string | null;
  stakeUnits: number | null;
  // The market / intern / edge numbers all describe ONE fighter: the bet
  // fighter when there's a bet, otherwise the picked fighter. Naming it
  // keeps the table honest about whose probability each column is.
  focusName: string;
  marketProb: number | null; // de-vigged, null when the fight is unpriced
  internProb: number;
  edgePct: number | null; // edge on focusName at its price, null when unpriced
}

/**
 * The card-view "Intern's read" panel's data (features/picks/components/
 * InternCardRead.tsx) -- one row per fight the intern has an opinion on,
 * joining its stored pick to the card's live odds.
 *
 * The one non-obvious bit is which fighter each probability column
 * describes. A pick stores P(predicted fighter wins), but the intern
 * often bets the OTHER fighter (the underdog carries the value more
 * often -- see the reasoning in decideInternBet.ts). So when there's a
 * bet, every number here flips to the bet fighter via
 * probabilityForFighter -- the same reason that function exists at all.
 */
export function buildInternCardReadRows(
  fights: CardFight[],
  internPicks: Map<string, InternPickSummary>,
): InternCardReadRow[] {
  const rows: InternCardReadRow[] = [];

  for (const fight of fights) {
    const pick = internPicks.get(fight.id);
    if (!pick) continue;

    const nameById = (id: string) =>
      id === fight.fighter1.id ? fight.fighter1.name : fight.fighter2.name;

    const focusId = pick.betFighterId ?? pick.predictedFighterId;
    const focusName = nameById(focusId);
    const internProb = probabilityForFighter(
      focusId,
      pick.predictedFighterId,
      pick.estimatedProbability,
    );

    let marketProb: number | null = null;
    let edgePct: number | null = null;
    if (fight.odds) {
      const { prob1, prob2 } = devigTwoWay(fight.odds.fighter1_price, fight.odds.fighter2_price);
      const focusIsFighter1 = focusId === fight.fighter1.id;
      marketProb = focusIsFighter1 ? prob1 : prob2;
      const focusPrice = focusIsFighter1 ? fight.odds.fighter1_price : fight.odds.fighter2_price;
      edgePct = edge(internProb, focusPrice);
    }

    rows.push({
      fightId: fight.id,
      fighter1Name: fight.fighter1.name,
      fighter2Name: fight.fighter2.name,
      pickName: nameById(pick.predictedFighterId),
      method: pick.predictedMethod,
      betName: pick.betFighterId ? focusName : null,
      stakeUnits: pick.stakeUnits,
      focusName,
      marketProb,
      internProb,
      edgePct,
    });
  }

  return rows;
}
