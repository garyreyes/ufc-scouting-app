import type { SupabaseClient } from "@supabase/supabase-js";
import type { LegMarket, MethodGroup, OpenSlip, SlipArchetype, SlipLeg, SlipStatus } from "./types";

interface LegRow {
  id: string;
  fight_id: string | null;
  external_description: string | null;
  market: LegMarket;
  selection_detail: string | null;
  method_group: MethodGroup | null;
  price: number | string;
  leg_result: "pending" | "won" | "lost" | "void";
  fight: { fighter1: { name: string } | null; fighter2: { name: string } | null; event: { name: string } | null } | null;
  selection_fighter: { name: string } | null;
}

interface SlipRow {
  id: string;
  event_id: string | null;
  archetype: SlipArchetype;
  stake_php: number | string;
  stake_units: number | string;
  book: string | null;
  combined_price: number | string;
  placed_at: string;
  note: string | null;
  status: SlipStatus;
  bet_legs: LegRow[];
}

function fightLabel(fight: LegRow["fight"]): string | null {
  if (!fight || !fight.fighter1 || !fight.fighter2) return null;
  const eventPart = fight.event ? ` (${fight.event.name})` : "";
  return `${fight.fighter1.name} vs ${fight.fighter2.name}${eventPart}`;
}

/**
 * Q4's own read: every open slip the owner holds, each with its legs
 * embedded rather than fetched separately -- RLS ("bet_slips: owner
 * reads all"/"bet_legs: owner reads all", 0064) is the real gate, so
 * this is a plain session-aware read, same trust model as
 * getMyPicksForFights.
 *
 * numeric columns (stake_php, stake_units, combined_price, price) come
 * back as strings over PostgREST -- converted here at the boundary, same
 * convention as features/picks/api.ts.
 */
export async function getOpenSlips(supabase: SupabaseClient): Promise<OpenSlip[]> {
  const { data, error } = await supabase
    .from("bet_slips")
    .select(
      "id, event_id, archetype, stake_php, stake_units, book, combined_price, placed_at, note, status, " +
        "bet_legs(id, fight_id, external_description, market, selection_detail, method_group, price, leg_result, " +
        "fight:fight_id(fighter1:fighter1_id(name), fighter2:fighter2_id(name), event:event_id(name)), " +
        "selection_fighter:selection_fighter_id(name))",
    )
    .eq("status", "open")
    .order("placed_at", { ascending: false });
  if (error) throw error;

  return ((data ?? []) as unknown as SlipRow[]).map((row) => ({
    id: row.id,
    eventId: row.event_id,
    archetype: row.archetype,
    stakePhp: Number(row.stake_php),
    stakeUnits: Number(row.stake_units),
    book: row.book,
    combinedPrice: Number(row.combined_price),
    placedAt: row.placed_at,
    note: row.note,
    status: row.status,
    legs: row.bet_legs.map(
      (leg): SlipLeg => ({
        id: leg.id,
        fightId: leg.fight_id,
        fightLabel: fightLabel(leg.fight),
        externalDescription: leg.external_description,
        market: leg.market,
        selectionFighterName: leg.selection_fighter?.name ?? null,
        selectionDetail: leg.selection_detail,
        methodGroup: leg.method_group,
        price: Number(leg.price),
        legResult: leg.leg_result,
      }),
    ),
  }));
}
