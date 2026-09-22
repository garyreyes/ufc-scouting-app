"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { toCentavos } from "@/lib/betting/settleSlip";
import { getCardView } from "@/features/fights/api";
import type { FightOption, NewSlipInput } from "./types";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return { supabase, user };
}

function validateSlipInput(input: NewSlipInput): void {
  if (input.legs.length === 0) throw new Error("A slip needs at least one leg");
  if (!(input.stakePhp > 0)) throw new Error("Stake must be greater than 0");
  if (!(input.combinedPrice > 1)) throw new Error("Combined price must be greater than 1");

  for (const leg of input.legs) {
    // The DB's own CHECK constraints (0064) are the real enforcement --
    // this exists only to turn an opaque constraint-violation error into
    // one that names which leg and what's missing, same as upsertPick's
    // predictedMethod check in features/picks/actions.ts.
    if (leg.fightId === null && leg.externalDescription === null) {
      throw new Error("Every leg needs a fight or a description");
    }
    if (!(leg.price > 1)) throw new Error("Every leg's price must be greater than 1");
    if (leg.market !== "OTHER" && leg.market !== "METHOD_FIGHT" && leg.selectionFighterId === null) {
      throw new Error(`A ${leg.market} leg needs a selected fighter`);
    }
    if ((leg.market === "METHOD_FIGHTER" || leg.market === "METHOD_FIGHT") && leg.methodGroup === null) {
      throw new Error(`A ${leg.market} leg needs a method group`);
    }
  }
}

/**
 * The leg picker's own data source (SlipForm.tsx): a chosen event's
 * fights, in the shape a leg row actually needs. Public read -- fights/
 * events have anon grants -- so no requireUser() here, matching
 * getConflictsBadgeAction's own read-only exception in
 * features/conflicts/actions.ts.
 */
export async function getFightsForEventAction(eventId: string): Promise<FightOption[]> {
  const card = await getCardView(eventId);
  if (!card) return [];
  return card.fights.map((f) => ({ id: f.id, fighter1: f.fighter1, fighter2: f.fighter2 }));
}

/**
 * Q4's record action. Inserts the slip then its legs -- both as plain
 * RLS-scoped writes (author='USER', user_id=auth.uid()), matching
 * upsertPick's trust model in features/picks/actions.ts: RLS plus 0064's
 * triggers are the real enforcement (a client can only ever write
 * status='open'/leg_result='pending', the triggers reject anything else),
 * this only rejects an obviously-incomplete leg early with a clear
 * message.
 */
export async function createSlipAction(input: NewSlipInput): Promise<void> {
  const { supabase, user } = await requireUser();
  validateSlipInput(input);

  const { data: slip, error: slipError } = await supabase
    .from("bet_slips")
    .insert({
      event_id: input.eventId,
      author: "USER",
      user_id: user.id,
      archetype: input.archetype,
      stake_php: input.stakePhp,
      stake_units: input.stakeUnits,
      book: input.book,
      bookmaker_bet_id: input.bookmakerBetId,
      combined_price: input.combinedPrice,
      placed_at: input.placedAt,
      note: input.note,
    })
    .select("id")
    .single();
  if (slipError) throw slipError;

  const { error: legsError } = await supabase.from("bet_legs").insert(
    input.legs.map((leg) => ({
      slip_id: slip.id,
      fight_id: leg.fightId,
      external_description: leg.externalDescription,
      market: leg.market,
      selection_fighter_id: leg.selectionFighterId,
      selection_detail: leg.selectionDetail,
      method_group: leg.methodGroup,
      price: leg.price,
    })),
  );
  if (legsError) throw legsError;

  revalidatePath("/betting");
}

/**
 * The owner-writable settlement exception (DECISIONS.md, 2026-09-21):
 * only the person who took a cash-out knows it happened or what it
 * returned, so this is a client action rather than something
 * settleBetSlips.ts could ever derive. The slip update runs through the
 * caller's own session (RLS already permits an owner setting
 * status='cashed_out' on their own USER slip -- 0064's trigger only
 * blocks won/lost/void). The ledger row does not: bankroll_ledger's
 * insert policy only grants kind in ('deposit','withdrawal','adjustment')
 * to authenticated, not 'slip_settlement' -- that kind is deliberately
 * writable only through the service-role connection (same reasoning as
 * features/conflicts/actions.ts's requireOwner()+admin-client pattern).
 * The refetch-and-check below, not the payload, is the real security
 * boundary for that second write.
 */
export async function cashOutSlipAction(slipId: string, payoutPhp: number): Promise<void> {
  const { supabase, user } = await requireUser();
  if (!(payoutPhp >= 0)) throw new Error("Payout must be 0 or more");

  const { data: slip, error: fetchError } = await supabase
    .from("bet_slips")
    .select("id, user_id, author, status, stake_php")
    .eq("id", slipId)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!slip || slip.author !== "USER" || slip.user_id !== user.id) {
    throw new Error("Slip not found");
  }
  if (slip.status !== "open") throw new Error("Only an open slip can be cashed out");

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("bet_slips")
    .update({ status: "cashed_out", payout_php: payoutPhp, settled_at: now })
    .eq("id", slipId);
  if (updateError) throw updateError;

  const admin: SupabaseClient = getSupabaseAdmin();
  const { error: ledgerError } = await admin.from("bankroll_ledger").insert({
    kind: "slip_settlement",
    amount_php: toCentavos(payoutPhp - Number(slip.stake_php)),
    slip_id: slipId,
    occurred_at: now,
  });
  if (ledgerError) throw ledgerError;

  revalidatePath("/betting");
}

/**
 * Removes a mis-entered slip -- 0064's own DELETE policy exists for
 * exactly this (unlike `picks`, which has no delete path at all). Legs
 * cascade; a slip that already has a bankroll_ledger row (settled or
 * cashed out) cannot be deleted -- the ledger's restrict FK is what stops
 * a deletion from quietly rewriting settled bankroll history, and that
 * error surfaces as-is rather than being caught and reworded.
 */
export async function deleteSlipAction(slipId: string): Promise<void> {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("bet_slips")
    .delete()
    .eq("id", slipId)
    .eq("user_id", user.id)
    .eq("author", "USER");
  if (error) throw error;
  revalidatePath("/betting");
}
