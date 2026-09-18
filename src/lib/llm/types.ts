// Shared shapes for the map-reduce harness (runMapReduce.ts) and its
// callers (rumours today; conflicts/scouting in later Phase N sub-phases).
// Kept in one file since every one of these is used by at least two other
// files in this directory.

export interface ModelRequest {
  prompt: string;
}

export interface ModelResponse {
  text: string;
  // The N1 spike found no dated, pinnable model id exists for any Flash
  // variant -- every id GET /v1beta/models returns is a rolling alias.
  // This field echoes the alias the response actually came from (from the
  // API's own `modelVersion` field), which detects the alias itself
  // changing but NOT a weight-level swap kept under the same alias -- that
  // needs a separate, periodic GET /v1beta/models comparison, not
  // something to do per call. See geminiClient.ts.
  modelVersion: string | null;
  promptTokens: number | null;
  outputTokens: number | null;
}

// A claim check may keep, narrow (strip fields, return a smaller claim),
// or drop entirely -- see verifyClaims.ts. `reason` is a stable slug,
// counted by name in Degradation.dropReasons rather than logged as free
// text, so "the Elo mismatch check has been firing on every claim for a
// week" is visible in job_runs.summary without a separate investigation.
export type ClaimCheck<TClaim, TFacts> = (
  claim: TClaim,
  facts: TFacts,
) => { ok: true; claim: TClaim } | { ok: false; reason: string };

export interface VerificationResult<TClaim> {
  kept: TClaim[];
  droppedCount: number;
  dropReasons: Record<string, number>;
}

export interface Degradation {
  mapLlm: number;
  mapFallback: number;
  mapBudgetDenied: number;
  mapParseFailed: number;
  // "pure" is not a degradation -- it is a surface whose reduce step is a
  // deterministic function by design, never an LLM call (N4's conflict
  // reconciliation: mixing candidate ids is a graph check, not a
  // judgment). Kept distinct from "fallback" (a reduce that wanted to be
  // an LLM call and degraded) so the two are never conflated in
  // describeDegradation.ts's warning logic.
  reduceMode: "llm" | "fallback" | "pure" | "budget_denied" | "skipped_no_units";
  mapClaimsProposed: number;
  mapClaimsKept: number;
  reduceClaimsProposed: number;
  reduceClaimsKept: number;
  dropReasons: Record<string, number>;
}

export type ReservationDecision =
  | { granted: true; callLogId: string }
  | { granted: false; reason: "daily_cap" | "rate_limited" | "surface_soft_cap" };
