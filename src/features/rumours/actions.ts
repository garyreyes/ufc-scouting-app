"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isOwner } from "@/lib/auth";
import type { RumourOutcome } from "./types";

const VALID_OUTCOMES: readonly RumourOutcome[] = ["confirmed", "refuted", "unknown"];

/**
 * Same pattern as features/conflicts/actions.ts's requireOwner:
 * rumour_flags has no client write grant at all (0024), so this check --
 * run server-side against the real session -- IS the actual security
 * boundary, not RLS.
 */
async function requireOwner(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isOwner(user?.id)) throw new Error("Not authorized");
}

/**
 * UC-5: mark whether a flag turned out to be real, once its fight has
 * settled. `outcome: null` unmarks it (the toggle-off case -- clicking an
 * already-selected state again).
 *
 * Re-fetches the flag's own fight and checks settled_at itself rather
 * than trusting anything the caller claims -- a flag can't be marked
 * before its fight actually happened, since "was this real" has no
 * answer yet. Enforced here, not a DB trigger -- see
 * 0026_rumour_flag_outcomes.sql's comment for why that's proportionate
 * for this field.
 */
export async function markRumourOutcomeAction(
  flagId: string,
  outcome: RumourOutcome | null,
): Promise<void> {
  await requireOwner();
  if (outcome !== null && !VALID_OUTCOMES.includes(outcome)) {
    throw new Error("Invalid outcome");
  }

  const admin = getSupabaseAdmin();

  const { data: flag, error: flagError } = await admin
    .from("rumour_flags")
    .select("id, fight_id")
    .eq("id", flagId)
    .maybeSingle();
  if (flagError) throw flagError;
  if (!flag) throw new Error("Flag not found");

  const { data: fight, error: fightError } = await admin
    .from("fights")
    .select("settled_at, event_id")
    .eq("id", flag.fight_id)
    .maybeSingle();
  if (fightError) throw fightError;
  if (!fight || fight.settled_at === null) {
    throw new Error("Can't mark a rumour's outcome before its fight has settled.");
  }

  const { error: updateError } = await admin
    .from("rumour_flags")
    .update({
      outcome,
      outcome_marked_at: outcome === null ? null : new Date().toISOString(),
    })
    .eq("id", flagId);
  if (updateError) throw updateError;

  revalidatePath(`/events/${fight.event_id}`);
  revalidatePath(`/fights/${flag.fight_id}`);
}
