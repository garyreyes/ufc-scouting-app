import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeFightMethod } from "./normalizeFightMethod";
import { settleLeg } from "./settleLeg";
import type { LegForSettlement, LegMarket, MethodGroup, SettledFightFacts } from "./settleLeg";
import { settleSlip, toCentavos } from "./settleSlip";
import type { LegForRollup, LegRollupResult } from "./settleSlip";
import { selectAllPages } from "../supabase/selectAllPages";
import { selectAllPagesByIds } from "../supabase/selectAllPagesByIds";

export interface SettleBetSlipsSummary {
  slipsSettled: number;
  legsSettled: number;
}

interface SlipRow {
  id: string;
  stake_php: number;
}

interface LegRow {
  id: string;
  slip_id: string;
  fight_id: string | null;
  market: LegMarket;
  selection_fighter_id: string | null;
  method_group: MethodGroup | null;
  price: number;
  leg_result: "pending" | "won" | "lost" | "void";
}

interface FightRow {
  id: string;
  winner_id: string | null;
  method: string | null;
  settled_at: string | null;
  settled_from: string | null;
}

/**
 * Q4's settlement job -- the same role settlePicks.ts plays for `picks`.
 * Rides settle.yml's existing cron via runSettlementJobsOnce.ts; no new
 * workflow.
 *
 * Writes go through the service-role admin client, the only role 0064's
 * triggers allow to set a leg's/slip's won/lost/void
 * (DECISIONS.md, 2026-09-21 "won/lost/void are service-role-only"). A
 * client can still write `cashed_out` directly -- that path is
 * actions.ts's cashOutSlipAction, not this job.
 *
 * Only `bet_legs.leg_result = 'pending'` rows are re-evaluated; a leg
 * already won/lost/void keeps its stored result rather than being
 * recomputed every run (recomputing would be harmless since settleLeg is
 * pure, but re-touching settled_at on every pass would make it stop
 * meaning "when this leg was actually decided"). A leg settleLeg reports
 * as "undetermined" (no fight row, a market this app can't read, or an
 * unresolved fight) is left pending for manual settlement -- see
 * DECISIONS.md, 2026-09-21 "settlement may never guess a method."
 *
 * A slip settles the moment its legs' combined rollup leaves "open"
 * (settleSlip.ts) -- writes payout_php/status/settled_at on the slip and
 * exactly one bankroll_ledger row (kind='slip_settlement', amount_php =
 * payout - stake, i.e. the same net figure as the slip's own generated
 * pnl_php). No ledger row is written for stake placement -- see
 * bankroll_ledger's own schema comment: the ledger only ever records a
 * slip's NET settlement effect, not its stake leaving the bankroll up
 * front.
 */
export async function settleBetSlips(supabase: SupabaseClient): Promise<SettleBetSlipsSummary> {
  const now = new Date().toISOString();

  const openSlips = await selectAllPages<SlipRow>(supabase, "bet_slips", "id, stake_php", (q) =>
    q.eq("status", "open"),
  );
  if (openSlips.length === 0) return { slipsSettled: 0, legsSettled: 0 };

  const slipIds = openSlips.map((s) => s.id);
  const legs = await selectAllPagesByIds<LegRow>(
    supabase,
    "bet_legs",
    "id, slip_id, fight_id, market, selection_fighter_id, method_group, price, leg_result",
    "slip_id",
    slipIds,
  );

  const fightIds = [...new Set(legs.filter((l) => l.fight_id !== null).map((l) => l.fight_id as string))];
  const fights = await selectAllPagesByIds<FightRow>(
    supabase,
    "fights",
    "id, winner_id, method, settled_at, settled_from",
    "id",
    fightIds,
  );
  const fightById = new Map(fights.map((f) => [f.id, f]));

  const legsBySlipId = new Map<string, LegRow[]>();
  for (const leg of legs) {
    const arr = legsBySlipId.get(leg.slip_id) ?? [];
    arr.push(leg);
    legsBySlipId.set(leg.slip_id, arr);
  }

  let slipsSettled = 0;
  let legsSettled = 0;

  for (const slip of openSlips) {
    const slipLegs = legsBySlipId.get(slip.id) ?? [];
    const legsForRollup: LegForRollup[] = [];

    for (const leg of slipLegs) {
      if (leg.leg_result !== "pending") {
        legsForRollup.push({ result: leg.leg_result, price: leg.price });
        continue;
      }

      const fightRow = leg.fight_id === null ? undefined : fightById.get(leg.fight_id);
      const fight: SettledFightFacts | null =
        fightRow === undefined || fightRow.settled_at === null
          ? null
          : {
              winnerId: fightRow.winner_id,
              method: normalizeFightMethod(fightRow.method),
              isCancelled: fightRow.settled_from === "cancelled",
            };

      const legForSettlement: LegForSettlement = {
        market: leg.market,
        selectionFighterId: leg.selection_fighter_id,
        methodGroup: leg.method_group,
      };
      const result = settleLeg(legForSettlement, fight);

      if (result === "undetermined") {
        legsForRollup.push({ result: "pending", price: leg.price });
        continue;
      }

      const { error: legError } = await supabase
        .from("bet_legs")
        .update({ leg_result: result, settled_at: now })
        .eq("id", leg.id);
      if (legError) throw legError;
      legsSettled += 1;

      legsForRollup.push({ result: result as LegRollupResult, price: leg.price });
    }

    const rollup = settleSlip(legsForRollup, slip.stake_php);
    if (rollup.status === "open") continue;

    const { error: slipError } = await supabase
      .from("bet_slips")
      .update({ status: rollup.status, payout_php: rollup.payoutPhp, settled_at: now })
      .eq("id", slip.id);
    if (slipError) throw slipError;

    const { error: ledgerError } = await supabase.from("bankroll_ledger").insert({
      kind: "slip_settlement",
      amount_php: toCentavos(rollup.payoutPhp - slip.stake_php),
      slip_id: slip.id,
      occurred_at: now,
    });
    if (ledgerError) throw ledgerError;

    slipsSettled += 1;
  }

  return { slipsSettled, legsSettled };
}
