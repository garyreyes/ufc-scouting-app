import type { SupabaseClient } from "@supabase/supabase-js";
import { hashCanonicalJson } from "../promptHash";

// modelVersion (from ModelResponse) is deliberately not persisted here --
// N1 found it just echoes MODEL_ID back (the alias), never a dated build,
// so storing it per row would duplicate the model_id column for no real
// benefit. If a future spike finds a response field that DOES carry
// build-level detail, add it here rather than overloading this one.
export interface LlmCallLogUpdate {
  callLogId: string;
  status: "ok" | "error";
  prompt: string;
  rawOutput: string | null;
  error: string | null;
}

/**
 * Fills in the row reserveLlmCall.ts already inserted (reserve-before-call
 * -- 0047_llm_call_log.sql's header explains why). A logging failure here
 * must never mask the real call outcome the caller already has in hand,
 * matching runWithTracking.ts's own "never let bookkeeping override the
 * real result" rule -- so this only logs to console on error, it does not
 * throw.
 */
export async function logLlmCall(supabase: SupabaseClient, update: LlmCallLogUpdate): Promise<void> {
  const { error } = await supabase
    .from("llm_call_log")
    .update({
      finished_at: new Date().toISOString(),
      status: update.status,
      prompt_hash: hashCanonicalJson(update.prompt),
      prompt_chars: update.prompt.length,
      raw_output: update.rawOutput,
      error: update.error,
    })
    .eq("id", update.callLogId);
  if (error) console.error(`llm_call_log update failed for ${update.callLogId}:`, error);
}
