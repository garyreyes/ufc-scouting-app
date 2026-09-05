import { devigTwoWay } from "@/lib/scoring/devigTwoWay";
import { probabilityForFighter } from "@/lib/scoring/probabilityForFighter";
import { edge } from "@/lib/scoring/edge";
import type { FightMethod } from "@/lib/scoring/fightMethod";

interface CardFight {
  id: string;
  fighter1: { id: string; name: string };
  fighter2: { id: string; name: string };
  odds: { fighter1_price: number; fighter2_price: number } | null;
}

/**
 * The subset of a stored pick this panel needs. Both InternPickSummary
 * (the intern's picks) and MyPick (the owner's own) satisfy it -- they
 * are the same shape by 0019_picks.sql, and the card-read panel renders
 * either party the same way, so there is one builder, not two.
 */
export interface CardReadPick {
  predictedFighterId: string;
  estimatedProbability: number;
  confidence: number;
  predictedMethod: FightMethod | null;
  betFighterId: string | null;
  stakeUnits: number | null;
}

export interface CardReadRow {
  fightId: string;
  fighter1Name: string;
  fighter2Name: string;
  pickName: string;
  confidence: number;
  method: FightMethod | null;
  // Which fighter was staked on, and how much -- null when a pick was
  // made but the bet declined (the common case for the intern).
  betName: string | null;
  stakeUnits: number | null;
  // The market / picker / edge numbers all describe ONE fighter: the bet
  // fighter when there's a bet, otherwise the picked fighter. Naming it
  // keeps the table honest about whose probability each column is.
  focusName: string;
  marketProb: number | null; // de-vigged, null when the fight is unpriced
  pickerProb: number;
  edgePct: number | null; // edge on focusName at its price, null when unpriced
}

/**
 * The card-view read panel's data (features/picks/components/CardRead.tsx)
 * -- one row per fight the given party has an opinion on, joining its
 * stored pick to the card's live odds. Used for both the intern's picks
 * and the owner's own, from the same /events/[id] owner-gated branch.
 *
 * The one non-obvious bit is which fighter each probability column
 * describes. A pick stores P(predicted fighter wins), but a bet often
 * backs the OTHER fighter (the underdog carries the value more often --
 * see the reasoning in decideInternBet.ts). So when there's a bet, every
 * number here flips to the bet fighter via probabilityForFighter -- the
 * same reason that function exists at all.
 */
export function buildCardReadRows(
  fights: CardFight[],
  picks: Map<string, CardReadPick>,
): CardReadRow[] {
  const rows: CardReadRow[] = [];

  for (const fight of fights) {
    const pick = picks.get(fight.id);
    if (!pick) continue;

    const nameById = (id: string) =>
      id === fight.fighter1.id ? fight.fighter1.name : fight.fighter2.name;

    const focusId = pick.betFighterId ?? pick.predictedFighterId;
    const focusName = nameById(focusId);
    const pickerProb = probabilityForFighter(
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
      edgePct = edge(pickerProb, focusPrice);
    }

    rows.push({
      fightId: fight.id,
      fighter1Name: fight.fighter1.name,
      fighter2Name: fight.fighter2.name,
      pickName: nameById(pick.predictedFighterId),
      confidence: pick.confidence,
      method: pick.predictedMethod,
      betName: pick.betFighterId ? focusName : null,
      stakeUnits: pick.stakeUnits,
      focusName,
      marketProb,
      pickerProb,
      edgePct,
    });
  }

  return rows;
}
