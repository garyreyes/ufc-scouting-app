import type { SupabaseClient } from "@supabase/supabase-js";
import { callModel } from "./openRouterClient";
import { reserveLlmCall } from "./budget/reserveLlmCall";
import { logLlmCall } from "./budget/logLlmCall";
import { OPENROUTER_MODEL_ID } from "./models";
import type { MapReduceDeps } from "./runMapReduce";

// No stable per-model daily cap exists for OpenRouter's free tier -- it
// draws from a pool shared across ALL of OpenRouter's free-tier users
// (Phase 0 spike, 2026-09-19), not a per-key quota the way Groq's is. This
// cap exists only so `llm_call_log`'s bookkeeping has SOME ceiling to
// enforce per `try_reserve_llm_call`'s contract; it is deliberately loose
// and not meant to be treated as a real measured limit the way GROQ_QUOTA
// or Gemini's QUOTA are.
const OPENROUTER_LOOSE_DAILY_CAP = 200;

/**
 * OpenRouter's counterpart to createMapReduceDeps.ts / createGroqMapReduceDeps.ts.
 *
 * Every caller using this deps object inherits runMapReduce.ts's existing
 * per-unit degrade-to-fallback behavior for free: a thrown error from
 * openRouterClient.ts's callModel (expected and routine for this provider
 * -- see that file's own doc comment) is already caught per-unit and
 * counted as `mapFallback`, never allowed to fail the whole run. No new
 * fallback handling was written for this file specifically; it relies
 * entirely on that existing mechanism.
 */
export function createOpenRouterMapReduceDeps(supabase: SupabaseClient): MapReduceDeps {
  return {
    callModel,
    reserve: (surface: string) =>
      reserveLlmCall(supabase, surface, {
        modelId: OPENROUTER_MODEL_ID,
        dailyCap: OPENROUTER_LOOSE_DAILY_CAP,
        minIntervalMs: 0,
      }),
    logCall: (record) =>
      logLlmCall(supabase, {
        callLogId: record.callLogId,
        status: record.status,
        prompt: record.prompt,
        rawOutput: record.rawOutput,
        error: record.error,
      }),
    sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}
