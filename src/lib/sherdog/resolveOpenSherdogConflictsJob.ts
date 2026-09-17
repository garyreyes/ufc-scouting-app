import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchFighterHtmlById, type FetchOptions } from "./client";
import { parseFightHistory } from "./parseFightHistory";
import { historyCorroborates } from "./historyCorroborates";
import { fetchKnownOpponentBouts } from "./fetchKnownOpponentBouts";
import { buildSherdogMatchResolution } from "../../features/conflicts/resolveSherdogMatch";
import type { LowConfidenceSherdogMatchConflict, LowConfidenceSherdogMatchDetails } from "../../features/conflicts/types";

export interface ResolveOpenSherdogConflictsSummary {
  checked: number;
  resolved: number;
  failed: number;
  dryRun: boolean;
}

// Matches resolveSherdogIdentityJob.ts's own HISTORY_CORROBORATION_MAX_
// CANDIDATES -- same real ceiling (David Martínez's own open conflict has
// exactly 20, Sherdog's own search-results cap), same fail-safe posture.
export const MAX_CANDIDATES = 20;

/**
 * Pure eligibility check, extracted so the actual filtering rule is
 * directly testable without a fake Supabase client: `guard_mismatch`
 * conflicts are out of scope (see this module's own header), and a
 * candidate list outside (0, MAX_CANDIDATES] is skipped the same way
 * resolveSherdogIdentityJob.ts's own history-corroboration path is.
 */
export function isEligibleForHistoryCheck(details: LowConfidenceSherdogMatchDetails): boolean {
  if (details.reason === "guard_mismatch") return false;
  return details.candidates.length > 0 && details.candidates.length <= MAX_CANDIDATES;
}

/**
 * M5: re-examines every OPEN low_confidence_sherdog_match conflict
 * already sitting in data_conflicts (opened by a prior run of
 * resolveSherdogIdentityJob.ts, before this feature existed, or by a case
 * this feature's own bounds didn't cover at the time) and tries the same
 * history-corroboration check against its already-snapshotted candidate
 * list -- no new Sherdog search needed, the candidates were captured
 * when the conflict was opened.
 *
 * Deliberately skips `guard_mismatch` conflicts (see historyCorroborates.ts's
 * own header: that reason means the page's own name already failed a
 * plausibility check against a SINGLE candidate, not "which of several
 * candidates is right" -- a different, riskier question this feature
 * does not try to answer).
 *
 * `dryRun: true` performs every read and fetch but writes nothing -- same
 * discipline as resolveSherdogIdentityJob.ts's own dry run.
 */
export async function resolveOpenSherdogConflicts(
  supabase: SupabaseClient,
  opts: FetchOptions & { dryRun?: boolean } = {},
): Promise<ResolveOpenSherdogConflictsSummary> {
  const { dryRun = false, ...fetchOpts } = opts;
  const summary: ResolveOpenSherdogConflictsSummary = { checked: 0, resolved: 0, failed: 0, dryRun };

  const { data, error } = await supabase
    .from("data_conflicts")
    .select("id, details")
    .eq("kind", "low_confidence_sherdog_match")
    .is("resolved_at", null);
  if (error) throw error;

  for (const row of data ?? []) {
    const details = row.details as LowConfidenceSherdogMatchDetails;
    if (!isEligibleForHistoryCheck(details)) continue;

    summary.checked++;
    try {
      const knownBouts = await fetchKnownOpponentBouts(supabase, details.fighterId);
      if (knownBouts.length === 0) continue; // nothing to corroborate against yet

      const corroborated: number[] = [];
      for (const candidate of details.candidates) {
        const html = await fetchFighterHtmlById(candidate.sherdogId, fetchOpts);
        const history = parseFightHistory(html);
        if (historyCorroborates(knownBouts, history)) corroborated.push(candidate.sherdogId);
      }
      if (corroborated.length !== 1) continue;

      if (dryRun) {
        summary.resolved++;
        console.log(`  would auto-resolve  ${details.storedName} -> #${corroborated[0]}`);
        continue;
      }

      const conflict: LowConfidenceSherdogMatchConflict = {
        id: row.id,
        kind: "low_confidence_sherdog_match",
        fightId: null,
        detectedAt: "",
        details,
      };
      const resolution = buildSherdogMatchResolution(conflict, corroborated[0]);

      if (resolution.fightersUpdate) {
        // Same race guard as the manual action (resolveSherdogMatchAction):
        // fighters.sherdog_id is unique, so if another run already
        // claimed this id for a different fighter, this write is
        // rejected rather than pointing two rows at one Sherdog person.
        const { error: fightersError } = await supabase
          .from("fighters")
          .update(resolution.fightersUpdate)
          .eq("id", details.fighterId);
        if (fightersError) throw fightersError;
      }

      // Reviewer finding: unlike the manual action this pattern is
      // copied from, there's a real gap here for a concurrent write to
      // land in -- the loop above does up to 20 rate-limited Sherdog
      // fetches between the initial select and this update, a much
      // wider window than the manual action's instant one. Re-checking
      // resolved_at IS NULL here means a human resolving the same
      // conflict via /conflicts mid-loop wins; this write is silently
      // skipped (0 rows matched) instead of overwriting their choice.
      const { error: conflictError } = await supabase
        .from("data_conflicts")
        .update(resolution.conflictUpdate)
        .eq("id", row.id)
        .is("resolved_at", null);
      if (conflictError) throw conflictError;

      summary.resolved++;
    } catch (err) {
      summary.failed++;
      console.error(`resolveOpenSherdogConflicts failed for conflict ${row.id} (${details.storedName}):`, err);
    }
  }

  return summary;
}
