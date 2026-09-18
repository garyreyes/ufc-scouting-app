import type { SupabaseClient } from "@supabase/supabase-js";
import type { LowConfidenceSherdogMatchDetails } from "../../features/conflicts/types";
import type { ConflictToPropose } from "./types";

/**
 * Every currently-open `low_confidence_sherdog_match` conflict, reshaped
 * for the proposal prompt/checks -- same source table
 * resolveOpenSherdogConflictsJob.ts (M5) reads, but this file makes no
 * assumption about what that job already tried: whatever is still open
 * by the time this runs (on its own schedule) is, by construction, what
 * the heuristic either declined or hasn't reached yet.
 */
export async function fetchOpenSherdogConflictsToPropose(supabase: SupabaseClient): Promise<ConflictToPropose[]> {
  const { data, error } = await supabase
    .from("data_conflicts")
    .select("id, details")
    .eq("kind", "low_confidence_sherdog_match")
    .is("resolved_at", null);
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
