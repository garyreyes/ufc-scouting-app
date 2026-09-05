"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_QUICK_PICK_CONFIDENCE } from "./quickPickBands";
import { mergePickFields } from "./mergePickFields";
import { isFightMethod } from "@/lib/scoring/fightMethod";
import type { PickFields } from "./types";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return { supabase, user };
}

async function fetchExistingPickFields(
  supabase: SupabaseClient,
  userId: string,
  fightId: string,
): Promise<PickFields | null> {
  const { data, error } = await supabase
    .from("picks")
    .select("predicted_fighter_id, estimated_probability, confidence, predicted_method, reasoning, bet_fighter_id, stake_units")
    .eq("author", "USER")
    .eq("user_id", userId)
    .eq("fight_id", fightId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    predictedFighterId: data.predicted_fighter_id,
    estimatedProbability: data.estimated_probability,
    confidence: data.confidence,
    predictedMethod: data.predicted_method,
    reasoning: data.reasoning,
    betFighterId: data.bet_fighter_id,
    stakeUnits: data.stake_units,
  };
}

/**
 * Read-merge-write, not a bare `.upsert(partialObject)` -- see
 * mergePickFields.ts. Both save actions below funnel through this so
 * neither can silently blank out a field the *other* one owns just
 * because its own payload didn't mention it.
 */
async function upsertPick(
  supabase: SupabaseClient,
  userId: string,
  fightId: string,
  existing: PickFields | null,
  updates: Partial<PickFields>,
): Promise<void> {
  const merged = mergePickFields(existing, updates);

  // The form only ever emits one of the three enum values or null, and
  // 0035's CHECK constraint is the real backstop -- but a server action
  // is a trust boundary, so reject a bad value here with a clear message
  // rather than letting it surface as an opaque DB constraint error.
  if (merged.predictedMethod !== null && !isFightMethod(merged.predictedMethod)) {
    throw new Error(`Invalid predicted method: ${merged.predictedMethod}`);
  }

  const { error } = await supabase.from("picks").upsert(
    {
      fight_id: fightId,
      author: "USER",
      user_id: userId,
      predicted_fighter_id: merged.predictedFighterId,
      estimated_probability: merged.estimatedProbability,
      confidence: merged.confidence,
      predicted_method: merged.predictedMethod,
      reasoning: merged.reasoning,
      bet_fighter_id: merged.betFighterId,
      stake_units: merged.stakeUnits,
    },
    { onConflict: "fight_id,author" },
  );
  if (error) throw error;

  revalidatePath("/events/[id]", "page");
}

/**
 * The quick-pick save (C3) -- unlike features/job-health or features/
 * conflicts' owner-gated actions, `picks` has real client-facing RLS
 * policies (0019_picks.sql: "picks: owner writes own USER picks"), so
 * this is a plain session-aware write -- RLS (author='USER' and
 * user_id=auth.uid() and is_owner()) plus the pick-lock trigger
 * (check_pick_constraints: card-lock, fighter-membership, open-conflict)
 * are the real enforcement, already built and tested in C1. This action
 * does not re-validate any of that -- doing so would duplicate logic the
 * database already owns and is a worse place to keep it in sync.
 *
 * `confidence` only gets the neutral default on a brand-new row -- if
 * C4's expanded row already set a real value, retapping a quick-pick band
 * must not quietly revert it back to 3.
 */
export async function saveQuickPickAction(
  fightId: string,
  predictedFighterId: string,
  estimatedProbability: number,
): Promise<void> {
  const { supabase, user } = await requireUser();
  const existing = await fetchExistingPickFields(supabase, user.id, fightId);

  await upsertPick(supabase, user.id, fightId, existing, {
    predictedFighterId,
    estimatedProbability,
    ...(existing === null ? { confidence: DEFAULT_QUICK_PICK_CONFIDENCE } : {}),
  });
}

/**
 * C4's expanded row: confidence, predicted method, reasoning, and the
 * optional bet (bet_fighter_id + stake_units), plus a refined
 * estimated_probability anchored to implied (betProbabilityBands.ts).
 * Requires an existing pick -- UC-2's own framing is "log a pick, and
 * *separately* decide whether to bet it," so this never creates a pick
 * from nothing; QuickPick is the only entry point for that. Passing
 * `betFighterId: null, stakeUnits: null` removes an existing bet without
 * touching the pick itself (mergePickFields treats an explicit null as
 * "clear this," distinct from omitting the key).
 */
export async function saveBetAction(
  fightId: string,
  updates: Partial<PickFields>,
): Promise<void> {
  const { supabase, user } = await requireUser();
  const existing = await fetchExistingPickFields(supabase, user.id, fightId);
  if (existing === null) {
    throw new Error("Make a pick before placing a bet.");
  }

  await upsertPick(supabase, user.id, fightId, existing, updates);
}
