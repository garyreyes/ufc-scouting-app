"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_QUICK_PICK_CONFIDENCE } from "./quickPickBands";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return { supabase, user };
}

/**
 * The quick-pick save (C3) -- upserts rather than a plain insert, so
 * tapping a different fighter before the card locks changes the existing
 * pick instead of colliding with 0019_picks.sql's unique(fight_id,
 * author). Unlike features/job-health or features/conflicts' owner-gated
 * actions, `picks` has real client-facing RLS policies (0019_picks.sql:
 * "picks: owner writes own USER picks"), so this is a plain session-
 * aware write -- RLS (author='USER' and user_id=auth.uid() and
 * is_owner()) plus the pick-lock trigger (check_pick_constraints:
 * card-lock, fighter-membership, open-conflict) are the real
 * enforcement, already built and tested in C1. This action does not
 * re-validate any of that -- doing so would duplicate logic the database
 * already owns and is a worse place to keep it in sync.
 */
export async function saveQuickPickAction(
  fightId: string,
  predictedFighterId: string,
  estimatedProbability: number,
): Promise<void> {
  const { supabase, user } = await requireUser();

  const { error } = await supabase.from("picks").upsert(
    {
      fight_id: fightId,
      author: "USER",
      user_id: user.id,
      predicted_fighter_id: predictedFighterId,
      estimated_probability: estimatedProbability,
      confidence: DEFAULT_QUICK_PICK_CONFIDENCE,
    },
    { onConflict: "fight_id,author" },
  );
  if (error) throw error;

  revalidatePath("/events/[id]", "page");
}
