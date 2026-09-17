import type { SupabaseClient } from "@supabase/supabase-js";
import { fightOutcomeFromSettledFight } from "../scoring/fightOutcomeFromSettledFight";
import { scorePickCorrect } from "../scoring/scorePickCorrect";
import { scoreBetPnl } from "../scoring/scoreBetPnl";
import { priceForFighter } from "../scoring/priceForFighter";
import { selectAllPages } from "../supabase/selectAllPages";
import { selectAllPagesByIds } from "../supabase/selectAllPagesByIds";

export interface SettlePicksSummary {
  picksSettled: number;
  fightsProcessed: number;
}

/**
 * D2 -- writes pick_correct/pnl_units onto every pick once its fight has
 * settled (D1). All the actual judgment lives in already-tested pure
 * functions (fightOutcomeFromSettledFight, scorePickCorrect,
 * scoreBetPnl, priceForFighter); this is thin I/O glue finding the work
 * and writing the result, matching lib/odds/matchAndSnapshot.ts's own
 * shape.
 *
 * `picks.settled_at` (0022_dual_settlement.sql) is the only reliable
 * "has this pick been processed" signal -- pick_correct/pnl_units alone
 * can't tell a genuinely unsettled pick apart from a settled void pick
 * with no bet, since both are null/null forever.
 *
 * Writes go through the service-role admin client, the only role
 * 0022's trigger allows to set these three columns at all -- see that
 * migration's own comment on why (and how it's verified, not assumed).
 *
 * M1: the unsettled-picks read is paged with selectAllPages (a plain
 * `.select()` truncates at PostgREST's row cap with no error), and the
 * fights/odds_snapshots lookups go through selectAllPagesByIds so their
 * `.in()` lists are chunked instead of growing unbounded with the number
 * of unsettled picks.
 */
export async function settlePicks(supabase: SupabaseClient): Promise<SettlePicksSummary> {
  const now = new Date().toISOString();

  const unsettledPicks = await selectAllPages<{
    id: string;
    fight_id: string;
    predicted_fighter_id: string;
    bet_fighter_id: string | null;
    stake_units: number | null;
  }>(supabase, "picks", "id, fight_id, predicted_fighter_id, bet_fighter_id, stake_units", (q) =>
    q.is("settled_at", null),
  );
  if (unsettledPicks.length === 0) {
    return { picksSettled: 0, fightsProcessed: 0 };
  }

  const fightIds = [...new Set(unsettledPicks.map((p) => p.fight_id))];
  const fights = await selectAllPagesByIds<{
    id: string;
    fighter1_id: string;
    fighter2_id: string;
    winner_id: string | null;
    settled_at: string | null;
  }>(supabase, "fights", "id, fighter1_id, fighter2_id, winner_id, settled_at", "id", fightIds);

  const settledFightById = new Map(fights.filter((f) => f.settled_at !== null).map((f) => [f.id, f]));

  const picksToSettle = unsettledPicks.filter((p) => settledFightById.has(p.fight_id));
  if (picksToSettle.length === 0) {
    return { picksSettled: 0, fightsProcessed: 0 };
  }

  const betFightIds = [
    ...new Set(picksToSettle.filter((p) => p.bet_fighter_id !== null).map((p) => p.fight_id)),
  ];
  const oddsRows = await selectAllPagesByIds<{
    id: string;
    fight_id: string;
    fighter1_price: number;
    fighter2_price: number;
  }>(supabase, "odds_snapshots", "id, fight_id, fighter1_price, fighter2_price", "fight_id", betFightIds);
  const oddsByFightId = new Map(
    oddsRows.map((row) => [
      row.fight_id,
      { fighter1_price: row.fighter1_price, fighter2_price: row.fighter2_price },
    ]),
  );

  for (const pick of picksToSettle) {
    const fight = settledFightById.get(pick.fight_id as string)!;
    const outcome = fightOutcomeFromSettledFight(fight.winner_id as string | null);
    const pickCorrect = scorePickCorrect(pick.predicted_fighter_id as string, outcome);

    let pnlUnits: number | null = null;
    if (pick.bet_fighter_id !== null) {
      // C4's BetRow only ever offers a bet once a fight is priced, so
      // this should never actually happen -- but a settlement job is
      // exactly the wrong place to guess at a missing price, so a real
      // data-integrity gap fails the whole run loudly rather than
      // silently skipping or writing a wrong number.
      const odds = oddsByFightId.get(pick.fight_id as string);
      if (!odds) {
        throw new Error(
          `Pick ${pick.id} has a bet on fight ${pick.fight_id}, but that fight has no odds snapshot -- cannot compute pnl_units.`,
        );
      }
      const price = priceForFighter(
        pick.bet_fighter_id as string,
        fight.fighter1_id as string,
        fight.fighter2_id as string,
        odds,
      );
      if (price === null) {
        throw new Error(
          `Pick ${pick.id}'s bet_fighter_id (${pick.bet_fighter_id}) is not one of fight ${pick.fight_id}'s two fighters.`,
        );
      }
      // Number(): stake_units is a numeric column -> a string over
      // PostgREST. scoreBetPnl's arithmetic coerces it correctly today,
      // but the value it's handed must match the number it's typed as.
      pnlUnits = scoreBetPnl(pick.bet_fighter_id as string, Number(pick.stake_units), price, outcome);
    }

    const { error: updateError } = await supabase
      .from("picks")
      .update({ pick_correct: pickCorrect, pnl_units: pnlUnits, settled_at: now })
      .eq("id", pick.id);
    if (updateError) throw updateError;
  }

  return { picksSettled: picksToSettle.length, fightsProcessed: settledFightById.size };
}
