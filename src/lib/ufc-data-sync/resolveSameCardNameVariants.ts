import type { SupabaseClient } from "@supabase/supabase-js";
import { identifyDifferingFighters } from "./identifyDifferingFighters";
import { decideAutoMerge, type MergeCandidateFighter } from "./decideSameCardMerge";
import { mergeFighters } from "./mergeFighters";

export interface ResolveSameCardVariantsSummary {
  conflictsChecked: number;
  merged: number;
  skippedNotVariant: number;
  skippedConflictingSherdogIds: number;
  dryRun: boolean;
}

interface ConflictRow {
  id: string;
  fight_id: string;
  details: { candidate_fighter1_id: string; candidate_fighter2_id: string };
}

/**
 * M3: sweeps every open disputed_opponent conflict and auto-merges the
 * ones that are a genuine same-card name variant (isSameCardNameVariant.ts,
 * via decideAutoMerge's stricter gate) -- exactly the "Jose Delgado" /
 * "Jose Miguel Delgado" shape found live: without this, "keep existing"
 * records nothing and the identical dispute reopens on the very next
 * sync. Meant to run right after the schedule sync, while conflicts are
 * still fresh.
 *
 * Never touches a conflict this run can't confidently classify: a fight
 * row that's gone missing, a candidate pair that no longer shares exactly
 * one fighter with it, or fewer than two fighter rows coming back all
 * fall through with no summary bucket incremented, rather than guessing.
 */
export async function resolveSameCardNameVariants(
  supabase: SupabaseClient,
  opts: { dryRun?: boolean; now?: () => Date } = {},
): Promise<ResolveSameCardVariantsSummary> {
  const dryRun = opts.dryRun ?? false;
  const now = opts.now ?? (() => new Date());
  const summary: ResolveSameCardVariantsSummary = {
    conflictsChecked: 0,
    merged: 0,
    skippedNotVariant: 0,
    skippedConflictingSherdogIds: 0,
    dryRun,
  };

  const { data: conflicts, error } = await supabase
    .from("data_conflicts")
    .select("id, fight_id, details")
    .eq("kind", "disputed_opponent")
    .is("resolved_at", null);
  if (error) throw error;
  if (!conflicts || conflicts.length === 0) return summary;

  for (const row of conflicts as unknown as ConflictRow[]) {
    summary.conflictsChecked++;

    const { data: fight, error: fightError } = await supabase
      .from("fights")
      .select("fighter1_id, fighter2_id")
      .eq("id", row.fight_id)
      .maybeSingle();
    if (fightError) throw fightError;
    if (!fight) continue;

    const diff = identifyDifferingFighters(
      { fighter1_id: fight.fighter1_id, fighter2_id: fight.fighter2_id },
      { fighter1_id: row.details.candidate_fighter1_id, fighter2_id: row.details.candidate_fighter2_id },
    );
    if (!diff) continue;

    const { data: fighterRows, error: fightersError } = await supabase
      .from("fighters")
      .select("id, name, external_id, sherdog_id")
      .in("id", [diff.a, diff.b]);
    if (fightersError) throw fightersError;
    if (!fighterRows || fighterRows.length !== 2) continue;

    const [fa, fb] = fighterRows as unknown as MergeCandidateFighter[];
    const decision = decideAutoMerge(fa, fb);
    if (!decision.eligible) {
      if (decision.reason === "conflicting_sherdog_ids") summary.skippedConflictingSherdogIds++;
      else summary.skippedNotVariant++;
      continue;
    }

    summary.merged++;
    if (dryRun) continue;

    await mergeFighters(supabase, decision.keepId, decision.dropId);
    const { error: resolveError } = await supabase
      .from("data_conflicts")
      .update({ resolved_at: now().toISOString(), resolution: "auto_alias" })
      .eq("id", row.id);
    if (resolveError) throw resolveError;
  }

  return summary;
}
