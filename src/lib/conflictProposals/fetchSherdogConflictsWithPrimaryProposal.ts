import type { SupabaseClient } from "@supabase/supabase-js";
import type { LowConfidenceSherdogMatchDetails } from "../../features/conflicts/types";
import type { ConflictToPropose } from "./types";

/**
 * Phase 2 (Track A)'s map input: every currently-open
 * `low_confidence_sherdog_match` conflict that already has a LIVE primary
 * (Gemini) proposal -- DECISIONS.md, 2026-09-20: the second opinion never
 * runs ahead of the primary, so "agreement" always compares two real
 * opinions, never a real one against a not-yet-computed one. A live
 * proposal is one N4's own resolveSherdogMatchDisplays already treats as
 * current: accepted_at and rejected_at both still null.
 */
export async function fetchSherdogConflictsWithPrimaryProposal(supabase: SupabaseClient): Promise<ConflictToPropose[]> {
  const { data, error } = await supabase
    .from("data_conflicts")
    .select("id, details, conflict_resolution_proposals!inner(conflict_id)")
    .eq("kind", "low_confidence_sherdog_match")
    .is("resolved_at", null)
    .is("conflict_resolution_proposals.accepted_at", null)
    .is("conflict_resolution_proposals.rejected_at", null);
  if (error) throw error;

  return (data ?? [])
    .map((row) => {
      const details = row.details as LowConfidenceSherdogMatchDetails;
      if (details.candidates.length === 0) return null; // nothing to propose
      return {
        conflictId: row.id as string,
        storedName: details.storedName,
        reason: details.reason ?? "below_threshold",
        ...(details.guardMismatchPageName ? { guardMismatchPageName: details.guardMismatchPageName } : {}),
        candidates: details.candidates.map((c) => ({
          sherdogId: c.sherdogId,
          name: c.name,
          confidence: c.confidence,
          nickname: c.nickname,
          association: c.association,
        })),
      };
    })
    .filter((c): c is ConflictToPropose => c !== null);
}
