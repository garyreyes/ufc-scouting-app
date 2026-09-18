import type { SupabaseClient } from "@supabase/supabase-js";
import { callModel } from "./geminiClient";
import { reserveLlmCall } from "./budget/reserveLlmCall";
import { logLlmCall } from "./budget/logLlmCall";
import type { MapReduceDeps } from "./runMapReduce";

/**
 * Wires the three real implementations (geminiClient, reserveLlmCall,
 * logLlmCall) into the shape runMapReduce.ts expects, so a job entry
 * point writes `runMapReduce(spec, createMapReduceDeps(supabase))` instead
 * of hand-assembling the same three-function object at every call site.
 * Tests use a hand-built MapReduceDeps directly (canned callModel/reserve
 * functions) and never import this file -- it exists purely to remove
 * boilerplate from production callers.
 */
export function createMapReduceDeps(supabase: SupabaseClient): MapReduceDeps {
  return {
    callModel,
    reserve: (surface: string) => reserveLlmCall(supabase, surface),
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
