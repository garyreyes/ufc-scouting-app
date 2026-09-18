import { MIN_CALL_INTERVAL_MS } from "./models";
import type { Degradation, ModelRequest, ModelResponse, ReservationDecision, VerificationResult } from "./types";

export type { Degradation };

export interface MappedUnit<TUnit, TMapClaim> {
  unit: TUnit;
  claims: TMapClaim[];
  source: "llm" | "fallback";
  // The llm_call_log row this unit's claims came from, when source is
  // "llm" -- null on "fallback" (nothing was ever reserved or called) so
  // a caller storing this alongside a decision (N4's
  // conflict_resolution_proposals.llm_call_id) has real traceability back
  // to the exact prompt/response, not just a boolean "used the LLM".
  callLogId: string | null;
}

/**
 * One implementation, three callers (rumours, conflicts, scouting) --
 * everything surface-specific arrives as a function here; everything
 * stateful (the model, the budget, the log) arrives injected via `deps`.
 * That split is what makes this file's own tests need zero network and
 * zero Supabase: `deps.callModel` can be a canned-string stub, `deps.reserve`
 * a scripted granted/denied sequence.
 *
 * `reduceViaLlm: false` (N4's conflict reconciliation) skips the reduce
 * call entirely and runs `reduceFallback` as the intended path, not a
 * degradation -- see types.ts's note on Degradation.reduceMode's "pure"
 * value.
 */
export interface MapReduceSpec<TUnit, TMapClaim, TReduceClaim, TFacts> {
  surface: "rumours" | "conflicts" | "scouting";
  units: TUnit[];
  facts: TFacts; // ground truth, fetched ONCE by the caller before this runs

  buildMapPrompt: (unit: TUnit, facts: TFacts) => string;
  parseMapResponse: (rawText: string, unit: TUnit) => TMapClaim[]; // throws on bad shape
  verifyMapClaims: (claims: TMapClaim[], unit: TUnit, facts: TFacts) => VerificationResult<TMapClaim>;
  mapFallback: (unit: TUnit, facts: TFacts) => TMapClaim[]; // heuristic; may return []

  reduceViaLlm: boolean;
  buildReducePrompt?: (mapped: MappedUnit<TUnit, TMapClaim>[], facts: TFacts) => string;
  parseReduceResponse?: (rawText: string) => TReduceClaim[];
  verifyReduceClaims?: (
    claims: TReduceClaim[],
    mapped: MappedUnit<TUnit, TMapClaim>[],
    facts: TFacts,
  ) => VerificationResult<TReduceClaim>;
  reduceFallback: (mapped: MappedUnit<TUnit, TMapClaim>[], facts: TFacts) => TReduceClaim[]; // deterministic
}

export interface MapReduceDeps {
  callModel: (req: ModelRequest) => Promise<ModelResponse>;
  reserve: (surface: string) => Promise<ReservationDecision>;
  // Mirrors budget/logLlmCall.ts's LlmCallLogUpdate shape without importing
  // it here -- this file has zero Supabase dependency by design (see the
  // class doc comment below), so it only depends on the SHAPE, and
  // production code (createMapReduceDeps.ts) wires the real function in.
  logCall: (record: {
    surface: string;
    callLogId: string;
    status: "ok" | "error";
    prompt: string;
    rawOutput: string | null;
    error: string | null;
  }) => Promise<void>;
  // Real per-process pacing (N7 finding, 2026-09-18): the architecture
  // this harness was built against ("Minimum 4s between calls, enforced
  // so no caller can forget it") was never actually implemented -- only
  // the atomic SQL reservation's interval DENIAL existed
  // (0047_llm_call_log.sql), with no caller ever waiting and retrying.
  // N2/N3/N4's unit counts (1, 1, <=10) never fanned out fast enough to
  // expose this; N7's real run against production (24 units) did --
  // 20 of 24 fighters were denied on their first real fan-out, exactly
  // the failure the plan's own N2 gate warned about ("a pacer that is
  // wrong is invisible until a card-sized run hits 429s"). Injected
  // (not a bare setTimeout call here) so this file's own tests stay
  // instant -- see createMapReduceDeps.ts for the real implementation.
  sleep: (ms: number) => Promise<void>;
}

export interface MapReduceOutcome<TUnit, TMapClaim, TReduceClaim> {
  claims: TReduceClaim[];
  mapped: MappedUnit<TUnit, TMapClaim>[];
  degradation: Degradation;
}

function emptyDegradation(): Degradation {
  return {
    mapLlm: 0,
    mapFallback: 0,
    mapBudgetDenied: 0,
    mapParseFailed: 0,
    reduceMode: "skipped_no_units",
    mapClaimsProposed: 0,
    mapClaimsKept: 0,
    reduceClaimsProposed: 0,
    reduceClaimsKept: 0,
    dropReasons: {},
  };
}

function mergeDropReasons(into: Record<string, number>, from: Record<string, number>): void {
  for (const [reason, count] of Object.entries(from)) {
    into[reason] = (into[reason] ?? 0) + count;
  }
}

async function callAndLog(
  deps: MapReduceDeps,
  surface: string,
  prompt: string,
): Promise<{ text: string; modelVersion: string | null; callLogId: string }> {
  const reservation = await deps.reserve(surface);
  if (!reservation.granted) {
    throw new BudgetDeniedError(reservation.reason);
  }
  try {
    const response = await deps.callModel({ prompt });
    await deps.logCall({
      surface,
      callLogId: reservation.callLogId,
      status: "ok",
      prompt,
      rawOutput: response.text,
      error: null,
    });
    return { text: response.text, modelVersion: response.modelVersion, callLogId: reservation.callLogId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.logCall({
      surface,
      callLogId: reservation.callLogId,
      status: "error",
      prompt,
      rawOutput: null,
      error: message,
    });
    throw err;
  }
}

/** Thrown internally when `deps.reserve` denies a call -- caught right
 * where each step decides how to degrade, never allowed to escape this
 * file. */
class BudgetDeniedError extends Error {}

export async function runMapReduce<TUnit, TMapClaim, TReduceClaim, TFacts>(
  spec: MapReduceSpec<TUnit, TMapClaim, TReduceClaim, TFacts>,
  deps: MapReduceDeps,
): Promise<MapReduceOutcome<TUnit, TMapClaim, TReduceClaim>> {
  const degradation = emptyDegradation();

  if (spec.units.length === 0) {
    return { claims: [], mapped: [], degradation };
  }

  const mapped: MappedUnit<TUnit, TMapClaim>[] = [];
  // Paced from the SECOND attempt onward (map or reduce) -- the first
  // attempt in a run has nothing to wait on. See MapReduceDeps.sleep's
  // own doc comment for why this exists at all.
  let isFirstAttempt = true;
  async function pace(): Promise<void> {
    if (isFirstAttempt) {
      isFirstAttempt = false;
      return;
    }
    await deps.sleep(MIN_CALL_INTERVAL_MS);
  }

  for (const unit of spec.units) {
    let claims: TMapClaim[];
    let source: "llm" | "fallback";
    let callLogId: string | null = null;

    try {
      await pace();
      const { text, callLogId: reservedId } = await callAndLog(deps, spec.surface, spec.buildMapPrompt(unit, spec.facts));
      callLogId = reservedId;
      let parsed: TMapClaim[];
      try {
        parsed = spec.parseMapResponse(text, unit);
      } catch (parseErr) {
        degradation.mapParseFailed++;
        throw parseErr; // preserved, not swallowed -- the outer catch only needs to know a failure happened, but a real debugging session needs the original message.
      }
      const verified = spec.verifyMapClaims(parsed, unit, spec.facts);
      degradation.mapClaimsProposed += parsed.length;
      degradation.mapClaimsKept += verified.kept.length;
      mergeDropReasons(degradation.dropReasons, verified.dropReasons);
      claims = verified.kept;
      source = "llm";
      degradation.mapLlm++;
    } catch (err) {
      // Every failure path -- budget denial, network/HTTP error, or a
      // parse failure (mapParseFailed already incremented above, before
      // this rethrow) -- lands here and degrades to the heuristic. Only
      // budget denials get their own counter; the rest share
      // mapFallback, matching Degradation's shape.
      if (err instanceof BudgetDeniedError) degradation.mapBudgetDenied++;
      claims = spec.mapFallback(unit, spec.facts);
      source = "fallback";
      degradation.mapFallback++;
    }

    mapped.push({ unit, claims, source, callLogId: source === "llm" ? callLogId : null });
  }

  if (!spec.reduceViaLlm) {
    degradation.reduceMode = "pure";
    const claims = spec.reduceFallback(mapped, spec.facts);
    degradation.reduceClaimsProposed = claims.length;
    degradation.reduceClaimsKept = claims.length;
    return { claims, mapped, degradation };
  }

  if (!spec.buildReducePrompt || !spec.parseReduceResponse || !spec.verifyReduceClaims) {
    throw new Error(
      `runMapReduce: surface "${spec.surface}" set reduceViaLlm: true but is missing buildReducePrompt/parseReduceResponse/verifyReduceClaims`,
    );
  }

  try {
    await pace();
    const { text } = await callAndLog(deps, spec.surface, spec.buildReducePrompt(mapped, spec.facts));
    const parsed = spec.parseReduceResponse(text);
    const verified = spec.verifyReduceClaims(parsed, mapped, spec.facts);
    degradation.reduceClaimsProposed = parsed.length;
    degradation.reduceClaimsKept = verified.kept.length;
    mergeDropReasons(degradation.dropReasons, verified.dropReasons);
    degradation.reduceMode = "llm";
    return { claims: verified.kept, mapped, degradation };
  } catch (err) {
    degradation.reduceMode = err instanceof BudgetDeniedError ? "budget_denied" : "fallback";
    const claims = spec.reduceFallback(mapped, spec.facts);
    degradation.reduceClaimsProposed = claims.length;
    degradation.reduceClaimsKept = claims.length;
    return { claims, mapped, degradation };
  }
}
