import type { SupabaseClient } from "@supabase/supabase-js";
import { DAILY_CALL_CAP, MIN_CALL_INTERVAL_MS, MODEL_ID } from "../models";
import { isWithinSurfaceSoftCap, SURFACE_SOFT_CAPS } from "./llmBudgetPolicy";
import type { ReservationDecision } from "../types";

/**
 * The I/O half of llmBudgetPolicy.ts. Two checks, two places, matching
 * that file's header comment:
 *
 * 1. Soft per-surface ceiling -- a plain SELECT count, non-atomic,
 *    checked here in TypeScript before ever calling Postgres.
 * 2. Daily cap + minimum call interval -- delegated to
 *    try_reserve_llm_call(), which counts and inserts a "reserved" row
 *    in one atomic statement so two concurrent job runs can never both
 *    see themselves as the 500th call of the day, or both fire inside
 *    the same 4.2s window.
 *
 * Returns a `callLogId` on success -- the caller (runMapReduce.ts, via
 * its own `logCall`) fills in the row's outcome (ok/error, raw output,
 * model version) after the actual model call returns. A reserved row
 * whose outcome never gets filled in (the process crashed mid-call)
 * still counts as spent on the next query -- the correct bias is
 * under-spending, which degrades to a fallback, never over-spending,
 * which produces a real 429 against the provider.
 */
export async function reserveLlmCall(
  supabase: SupabaseClient,
  surface: string,
): Promise<ReservationDecision> {
  const today = new Date().toISOString().slice(0, 10);

  const { count: surfaceCountToday, error: countError } = await supabase
    .from("llm_call_log")
    .select("id", { count: "exact", head: true })
    .eq("surface", surface)
    .eq("quota_day", today);
  if (countError) throw countError;

  if (!isWithinSurfaceSoftCap(surface, surfaceCountToday ?? 0)) {
    return { granted: false, reason: "surface_soft_cap" };
  }

  const { data, error } = await supabase.rpc("try_reserve_llm_call", {
    p_surface: surface,
    p_model_id: MODEL_ID,
    p_day: today,
    p_cap: DAILY_CALL_CAP,
    p_min_interval: `${MIN_CALL_INTERVAL_MS} milliseconds`,
  });
  if (error) throw error;

  if (data === null) {
    // The function's own documented contract (0047_llm_call_log.sql):
    // null means denied. Distinguishing daily_cap from rate_limited would
    // need a second read of the same rows the function already looked
    // at -- not worth another round trip for a distinction the caller
    // treats identically (see runMapReduce.ts's BudgetDeniedError).
    return { granted: false, reason: "daily_cap" };
  }

  return { granted: true, callLogId: data as string };
}

/** Re-exported so a caller building its own MapReduceDeps doesn't need a
 * second import just to know what surface names are configured. */
export { SURFACE_SOFT_CAPS };
