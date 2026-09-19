import type { SupabaseClient } from "@supabase/supabase-js";
import { callModel } from "./groqClient";
import { reserveLlmCall } from "./budget/reserveLlmCall";
import { logLlmCall } from "./budget/logLlmCall";
import { GROQ_MODEL_ID, GROQ_QUOTA } from "./models";
import type { MapReduceDeps } from "./runMapReduce";

/**
 * Groq's counterpart to createMapReduceDeps.ts -- same shape, wired to
 * groqClient.ts's callModel and Groq's own measured quota (GROQ_QUOTA:
 * 1000 RPD / 8000 TPM, see models.ts and DECISIONS.md's 2026-09-19 entry)
 * instead of Gemini's daily cap. The reservation's own min-interval guard
 * is set to 0 here since RPD, not RPM, is Groq's binding constraint (never
 * hit in the Phase 0 spike) -- but runMapReduce.ts's between-call `sleep`
 * still paces at Gemini's fixed MIN_CALL_INTERVAL_MS (4.2s) regardless of
 * which deps object is passed in; that constant is imported directly by
 * runMapReduce.ts, not read from `deps`. Safe for Groq (just slower than
 * strictly necessary, never a correctness issue), but worth revisiting --
 * parameterizing that pacing per-deps -- if a Groq-backed surface's real
 * throughput ever matters.
 *
 * A caller MUST keep every prompt built for this deps object scoped to a
 * single fighter/fight -- the existing whole-card shadow-picks prompt does
 * not fit Groq's 8000 TPM budget (measured live, not assumed).
 */
export function createGroqMapReduceDeps(supabase: SupabaseClient): MapReduceDeps {
  return {
    callModel,
    reserve: (surface: string) =>
      reserveLlmCall(supabase, surface, {
        modelId: GROQ_MODEL_ID,
        dailyCap: GROQ_QUOTA.rpd,
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
