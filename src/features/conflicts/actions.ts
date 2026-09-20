"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isOwner } from "@/lib/auth";
import { buildDisputedOpponentResolution } from "./resolveDisputedOpponent";
import type { DisputedOpponentChoice } from "./resolveDisputedOpponent";
import { identifyDifferingFighters } from "@/lib/ufc-data-sync/identifyDifferingFighters";
import { checkMergeGuard, type MergeCandidateFighter } from "@/lib/ufc-data-sync/decideSameCardMerge";
import { mergeFighters } from "@/lib/ufc-data-sync/mergeFighters";
import { buildLowConfidenceResolution } from "./resolveLowConfidence";
import type { LowConfidenceResolution } from "./resolveLowConfidence";
import { buildFighterMatchResolution } from "./resolveFighterMatch";
import { buildSherdogMatchResolution } from "./resolveSherdogMatch";
import { buildSherdogIdCollisionResolution } from "./resolveSherdogIdCollision";
import type { SherdogIdCollisionChoice } from "./resolveSherdogIdCollision";
import { getOpenConflictCount } from "./api";
import type {
  DisputedOpponentConflict,
  LowConfidenceConflict,
  LowConfidenceFighterMatchConflict,
  LowConfidenceSherdogMatchConflict,
  SherdogIdCollisionConflict,
} from "./types";

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

  // M3: "merge" asserts the two candidates are the same real person --
  // the actual identity fix happens here, via merge_fighters(), BEFORE
  // the conflict row itself is resolved below. checkMergeGuard's one hard
  // block (two different confirmed Sherdog identities) still applies to a
  // manual, owner-triggered merge exactly as it does to the automatic
  // sweep -- a human override doesn't get to corrupt Sherdog-sourced data.
  if (choice === "merge") {
    const { data: fight, error: fightError } = await admin
      .from("fights")
      .select("fighter1_id, fighter2_id")
      .eq("id", conflict.fightId)
      .maybeSingle();
    if (fightError) throw fightError;
    if (!fight) throw new Error("Fight not found");

    const diff = identifyDifferingFighters(
      { fighter1_id: fight.fighter1_id, fighter2_id: fight.fighter2_id },
      { fighter1_id: conflict.details.candidate_fighter1_id, fighter2_id: conflict.details.candidate_fighter2_id },
    );
    if (!diff) throw new Error("These two pairings no longer share exactly one fighter -- refusing to guess");

    const { data: fighterRows, error: fightersError } = await admin
      .from("fighters")
      .select("id, name, external_id, sherdog_id")
      .in("id", [diff.a, diff.b]);
    if (fightersError) throw fightersError;
    if (!fighterRows || fighterRows.length !== 2) throw new Error("Could not load both fighters to merge");

    const [fa, fb] = fighterRows as unknown as MergeCandidateFighter[];
    const guard = checkMergeGuard(fa, fb);
    if (!guard.allowed) {
      throw new Error(
        "These two fighters have different confirmed Sherdog identities and can't be merged automatically -- check /fighters for both before merging by hand.",
      );
    }

    await mergeFighters(admin, guard.keepId, guard.dropId);
  }

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

/**
 * `chosenFightId` null means "none of these" -- same "reject every
 * candidate, still resolve the row" shape resolveFighterMatchAction/
 * resolveSherdogMatchAction already use below. Skips the fight lookup
 * and odds_snapshots insert entirely: there's no fight to attach a price
 * to, so nothing else gets written.
 */
export async function resolveLowConfidenceAction(
  conflictId: string,
  chosenFightId: string | null,
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

  const conflict: LowConfidenceConflict = {
    id: row.id,
    kind: "low_confidence_odds_match",
    fightId: null,
    detectedAt: "", // unused by buildLowConfidenceResolution
    details: row.details as LowConfidenceConflict["details"],
  };

  let resolution: LowConfidenceResolution;
  if (chosenFightId === null) {
    resolution = buildLowConfidenceResolution(conflict, null, "", "");
  } else {
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
    resolution = buildLowConfidenceResolution(
      conflict,
      chosenFightId,
      typedFight.fighter1.name,
      typedFight.fighter2.name,
    );
  }

  if (resolution.kind === "no_price") {
    throw new Error("The odds payload doesn't have a price for these two fighters -- refusing to guess.");
  }

  if (resolution.kind === "resolved") {
    // odds_snapshots is immutable and unique(fight_id) -- if the automatic
    // job priced this fight from a different, higher-confidence event
    // between detection and now, this insert fails on the unique
    // constraint rather than silently double-pricing the fight. That's the
    // correct outcome, not an error to work around.
    const { error: snapshotError } = await admin.from("odds_snapshots").insert(resolution.snapshotInsert);
    if (snapshotError) throw snapshotError;
  }

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

/**
 * P6 (ROADMAP_V2.md): fighters.sherdog_id is UNIQUE, so this conflict
 * means a write collided with an already-claimed id -- structural proof
 * of a duplicate, not a name-similarity guess. "merge" asserts the two
 * rows are the same real person and folds them via the same
 * merge_fighters()/checkMergeGuard() path resolveDisputedOpponentAction's
 * own "merge" choice uses above (`fighterId`, sherdog_id null, is always
 * the row checkMergeGuard is free to drop or keep -- it never had a
 * confirmed identity to conflict with `existingFighterId`'s).
 * "not_same_person" means the search matched the wrong page; both rows
 * are left untouched.
 */
export async function resolveSherdogIdCollisionAction(
  conflictId: string,
  choice: SherdogIdCollisionChoice,
): Promise<void> {
  await requireOwner();
  const admin = getSupabaseAdmin();

  const { data: row, error } = await admin
    .from("data_conflicts")
    .select("id, details")
    .eq("id", conflictId)
    .eq("kind", "sherdog_id_collision")
    .is("resolved_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new Error("Conflict not found or already resolved");

  const conflict: SherdogIdCollisionConflict = {
    id: row.id,
    kind: "sherdog_id_collision",
    fightId: null,
    detectedAt: "", // unused by buildSherdogIdCollisionResolution
    details: row.details as SherdogIdCollisionConflict["details"],
  };

  if (choice === "merge") {
    const { data: fighterRows, error: fightersError } = await admin
      .from("fighters")
      .select("id, name, external_id, sherdog_id")
      .in("id", [conflict.details.fighterId, conflict.details.existingFighterId]);
    if (fightersError) throw fightersError;
    if (!fighterRows || fighterRows.length !== 2) throw new Error("Could not load both fighters to merge");

    const [fa, fb] = fighterRows as unknown as MergeCandidateFighter[];
    const guard = checkMergeGuard(fa, fb);
    if (!guard.allowed) {
      throw new Error(
        "These two fighters have different confirmed Sherdog identities and can't be merged automatically -- check /fighters for both before merging by hand.",
      );
    }

    await mergeFighters(admin, guard.keepId, guard.dropId);
  }

  const resolution = buildSherdogIdCollisionResolution(choice);

  const { error: conflictError } = await admin
    .from("data_conflicts")
    .update(resolution.conflictUpdate)
    .eq("id", conflictId);
  if (conflictError) throw conflictError;

  revalidatePath("/conflicts");
}

/**
 * J3b: the owner picks the right Sherdog fighter for a
 * low_confidence_sherdog_match, or rejects every candidate (null). The
 * fighter's sherdog_checked_at is already set (the identity job set it
 * when it opened the conflict), so a rejected match simply stays
 * sherdog_id null and is never auto-searched again.
 */
export async function resolveSherdogMatchAction(
  conflictId: string,
  chosenSherdogId: number | null,
): Promise<void> {
  await requireOwner();
  const admin = getSupabaseAdmin();

  const { data: row, error } = await admin
    .from("data_conflicts")
    .select("id, details")
    .eq("id", conflictId)
    .eq("kind", "low_confidence_sherdog_match")
    .is("resolved_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new Error("Conflict not found or already resolved");

  const conflict: LowConfidenceSherdogMatchConflict = {
    id: row.id,
    kind: "low_confidence_sherdog_match",
    fightId: null,
    detectedAt: "", // unused by buildSherdogMatchResolution
    details: row.details as LowConfidenceSherdogMatchConflict["details"],
  };

  const resolution = buildSherdogMatchResolution(conflict, chosenSherdogId);

  if (resolution.fightersUpdate) {
    // fighters.sherdog_id is unique -- if the identity job or another
    // manual resolution claimed this id for a different fighter between
    // detection and now, this write is rejected rather than pointing two
    // rows at one Sherdog person.
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
