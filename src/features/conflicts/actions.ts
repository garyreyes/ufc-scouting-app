"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isOwner } from "@/lib/auth";
import { buildDisputedOpponentResolution } from "./resolveDisputedOpponent";
import type { DisputedOpponentChoice } from "./resolveDisputedOpponent";
import { buildLowConfidenceResolution } from "./resolveLowConfidence";
import { buildFighterMatchResolution } from "./resolveFighterMatch";
import { getOpenConflictCount } from "./api";
import type { DisputedOpponentConflict, LowConfidenceConflict, LowConfidenceFighterMatchConflict } from "./types";

/**
 * Same pattern as job-health/actions.ts: data_conflicts, fights, and
 * odds_snapshots have no client write grant for this at all, so this
 * check -- run server-side against the real session -- is the actual
 * security boundary, not RLS. Never trust a conflictId alone; every
 * action below re-fetches the real row rather than accepting any part of
 * it from the caller.
 */
async function requireOwner(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isOwner(user?.id)) throw new Error("Not authorized");
}

/**
 * The sidebar badge count -- null means "don't show the nav item at
 * all," not just "zero," so a non-owner viewer never learns anything
 * about open conflicts existing. Called from a client component after
 * mount (Sidebar.tsx's ConflictsNavItem), not from the shared layout
 * render path -- same cookies()-taints-static-rendering reason as
 * job-health/actions.ts's checkCanRetryAction.
 */
export async function getConflictsBadgeAction(): Promise<number | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isOwner(user?.id)) return null;
  return getOpenConflictCount();
}

export async function resolveDisputedOpponentAction(
  conflictId: string,
  choice: DisputedOpponentChoice,
): Promise<void> {
  await requireOwner();
  const admin = getSupabaseAdmin();

  const { data: row, error } = await admin
    .from("data_conflicts")
    .select("id, fight_id, details")
    .eq("id", conflictId)
    .eq("kind", "disputed_opponent")
    .is("resolved_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new Error("Conflict not found or already resolved");

  const conflict: DisputedOpponentConflict = {
    id: row.id,
    kind: "disputed_opponent",
    fightId: row.fight_id as string,
    detectedAt: "", // unused by buildDisputedOpponentResolution
    details: row.details as DisputedOpponentConflict["details"],
  };

  const resolution = buildDisputedOpponentResolution(conflict, choice);

  if (resolution.fightsUpdate) {
    const { error: fightsError } = await admin
      .from("fights")
      .update(resolution.fightsUpdate)
      .eq("id", conflict.fightId);
    if (fightsError) throw fightsError;
  }

  const { error: conflictError } = await admin
    .from("data_conflicts")
    .update(resolution.conflictUpdate)
    .eq("id", conflictId);
  if (conflictError) throw conflictError;

  revalidatePath("/conflicts");
}

export async function resolveLowConfidenceAction(
  conflictId: string,
  chosenFightId: string,
): Promise<void> {
  await requireOwner();
  const admin = getSupabaseAdmin();

  const { data: row, error } = await admin
    .from("data_conflicts")
    .select("id, details")
    .eq("id", conflictId)
    .eq("kind", "low_confidence_odds_match")
    .is("resolved_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new Error("Conflict not found or already resolved");

  // The chosen fight's names, to parse the correct outcome prices out of
  // the odds payload -- same PostgREST FK-embed pattern used throughout.
  const { data: fight, error: fightError } = await admin
    .from("fights")
    .select("fighter1:fighter1_id(name), fighter2:fighter2_id(name)")
    .eq("id", chosenFightId)
    .maybeSingle();
  if (fightError) throw fightError;
  if (!fight) throw new Error("Chosen fight not found");

  const typedFight = fight as unknown as { fighter1: { name: string }; fighter2: { name: string } };

  const conflict: LowConfidenceConflict = {
    id: row.id,
    kind: "low_confidence_odds_match",
    fightId: null,
    detectedAt: "", // unused by buildLowConfidenceResolution
    details: row.details as LowConfidenceConflict["details"],
  };

  const resolution = buildLowConfidenceResolution(
    conflict,
    chosenFightId,
    typedFight.fighter1.name,
    typedFight.fighter2.name,
  );

  if (resolution.kind === "no_price") {
    throw new Error("The odds payload doesn't have a price for these two fighters -- refusing to guess.");
  }

  // odds_snapshots is immutable and unique(fight_id) -- if the automatic
  // job priced this fight from a different, higher-confidence event
  // between detection and now, this insert fails on the unique
  // constraint rather than silently double-pricing the fight. That's the
  // correct outcome, not an error to work around.
  const { error: snapshotError } = await admin.from("odds_snapshots").insert(resolution.snapshotInsert);
  if (snapshotError) throw snapshotError;

  const { error: conflictError } = await admin
    .from("data_conflicts")
    .update(resolution.conflictUpdate)
    .eq("id", conflictId);
  if (conflictError) throw conflictError;

  revalidatePath("/conflicts");
}

/**
 * `chosenExternalId` null means "none of these" -- the owner rejecting
 * every candidate. The fighter stays unenriched, exactly as it was
 * before this conflict was raised; it will not be re-searched
 * automatically (enrichFighters.ts's queue is `enrichment_checked_at is
 * null`, and this fighter's was already set the moment the conflict was
 * detected).
 */
export async function resolveFighterMatchAction(
  conflictId: string,
  chosenExternalId: string | null,
): Promise<void> {
  await requireOwner();
  const admin = getSupabaseAdmin();

  const { data: row, error } = await admin
    .from("data_conflicts")
    .select("id, details")
    .eq("id", conflictId)
    .eq("kind", "low_confidence_fighter_match")
    .is("resolved_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new Error("Conflict not found or already resolved");

  const conflict: LowConfidenceFighterMatchConflict = {
    id: row.id,
    kind: "low_confidence_fighter_match",
    fightId: null,
    detectedAt: "", // unused by buildFighterMatchResolution
    details: row.details as LowConfidenceFighterMatchConflict["details"],
  };

  const resolution = buildFighterMatchResolution(conflict, chosenExternalId);

  if (resolution.fightersUpdate) {
    // Same real safety net as the odds-side manual resolution: if this
    // external_id was independently claimed by another fighter row
    // between detection and now, the fighters.external_id unique
    // constraint rejects the write rather than silently creating two
    // rows pointing at the same real person.
    const { error: fightersError } = await admin
      .from("fighters")
      .update(resolution.fightersUpdate)
      .eq("id", conflict.details.fighterId);
    if (fightersError) throw fightersError;
  }

  const { error: conflictError } = await admin
    .from("data_conflicts")
    .update(resolution.conflictUpdate)
    .eq("id", conflictId);
  if (conflictError) throw conflictError;

  revalidatePath("/conflicts");
}
