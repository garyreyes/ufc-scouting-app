import { describe, expect, it, vi } from "vitest";
import { runMapReduce } from "./runMapReduce";
import { verifyClaims } from "./verifyClaims";
import type { MapReduceDeps, MapReduceSpec, MappedUnit } from "./runMapReduce";
import type { ClaimCheck, ModelResponse, ReservationDecision } from "./types";

interface Unit {
  id: string;
}
interface MapClaim {
  value: number;
}
interface ReduceClaim {
  total: number;
}
type Facts = Record<string, never>;

const FACTS: Facts = {};

function okResponse(text: string): ModelResponse {
  return { text, modelVersion: "gemini-3.5-flash-lite", promptTokens: 10, outputTokens: 5 };
}

function baseSpec(
  overrides: Partial<MapReduceSpec<Unit, MapClaim, ReduceClaim, Facts>> = {},
): MapReduceSpec<Unit, MapClaim, ReduceClaim, Facts> {
  const nonNegative: ClaimCheck<MapClaim, Facts> = (c) =>
    c.value >= 0 ? { ok: true, claim: c } : { ok: false, reason: "negative_value" };

  return {
    surface: "rumours",
    units: [],
    facts: FACTS,
    buildMapPrompt: (unit) => `map:${unit.id}`,
    parseMapResponse: (text) => JSON.parse(text) as MapClaim[],
    verifyMapClaims: (claims) => verifyClaims(claims, FACTS, [nonNegative]),
    mapFallback: () => [{ value: -999 }], // distinguishable heuristic marker for assertions
    reduceViaLlm: true,
    buildReducePrompt: (mapped) => `reduce:${mapped.length}`,
    parseReduceResponse: (text) => JSON.parse(text) as ReduceClaim[],
    verifyReduceClaims: (claims) => verifyClaims(claims, FACTS, []),
    reduceFallback: (mapped) => [{ total: mapped.reduce((s, m) => s + m.claims.length, 0) }],
    ...overrides,
  };
}

function baseDeps(overrides: Partial<MapReduceDeps> = {}): MapReduceDeps {
  return {
    callModel: vi.fn(),
    reserve: vi.fn(async (): Promise<ReservationDecision> => ({ granted: true, callLogId: "log-1" })),
    logCall: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("runMapReduce", () => {
  it("returns immediately with empty output and no calls for zero units", async () => {
    const deps = baseDeps();
    const spec = baseSpec({ units: [] });

    const outcome = await runMapReduce(spec, deps);

    expect(outcome.claims).toEqual([]);
    expect(outcome.mapped).toEqual([]);
    expect(outcome.degradation.reduceMode).toBe("skipped_no_units");
    expect(deps.callModel).not.toHaveBeenCalled();
    expect(deps.reserve).not.toHaveBeenCalled();
  });

  it("the full happy path: maps every unit via LLM, then reduces via LLM", async () => {
    const callModel = vi
      .fn()
      .mockResolvedValueOnce(okResponse('[{"value":1}]'))
      .mockResolvedValueOnce(okResponse('[{"value":2}]'))
      .mockResolvedValueOnce(okResponse('[{"total":3}]'));
    const deps = baseDeps({ callModel });
    const spec = baseSpec({ units: [{ id: "u1" }, { id: "u2" }] });

    const outcome = await runMapReduce(spec, deps);

    expect(outcome.claims).toEqual([{ total: 3 }]);
    expect(outcome.mapped).toEqual([
      { unit: { id: "u1" }, claims: [{ value: 1 }], source: "llm", callLogId: "log-1" },
      { unit: { id: "u2" }, claims: [{ value: 2 }], source: "llm", callLogId: "log-1" },
    ]);
    expect(outcome.degradation).toMatchObject({
      mapLlm: 2,
      mapFallback: 0,
      mapBudgetDenied: 0,
      mapParseFailed: 0,
      reduceMode: "llm",
      mapClaimsProposed: 2,
      mapClaimsKept: 2,
      reduceClaimsProposed: 1,
      reduceClaimsKept: 1,
    });
    expect(callModel).toHaveBeenCalledTimes(3); // 2 map + 1 reduce
  });

  it("falls back to the heuristic on a model failure, and counts it -- not the budget-denied counter", async () => {
    const callModel = vi.fn().mockRejectedValueOnce(new Error("Gemini request failed: 503"));
    const reduceFallback = vi.fn(() => [{ total: -1 }]);
    const deps = baseDeps({ callModel });
    const spec = baseSpec({ units: [{ id: "u1" }], reduceViaLlm: false, reduceFallback });

    const outcome = await runMapReduce(spec, deps);

    expect(outcome.mapped[0]).toEqual({
      unit: { id: "u1" },
      claims: [{ value: -999 }],
      source: "fallback",
      callLogId: null,
    });
    expect(outcome.degradation.mapFallback).toBe(1);
    expect(outcome.degradation.mapBudgetDenied).toBe(0);
    expect(outcome.degradation.mapLlm).toBe(0);
  });

  it("falls back on a budget denial, and counts mapBudgetDenied AND mapFallback both", async () => {
    const reserve = vi.fn(async (): Promise<ReservationDecision> => ({ granted: false, reason: "rate_limited" }));
    const deps = baseDeps({ reserve });
    const spec = baseSpec({ units: [{ id: "u1" }] });

    const outcome = await runMapReduce(spec, deps);

    expect(outcome.degradation.mapBudgetDenied).toBe(1);
    expect(outcome.degradation.mapFallback).toBe(1);
    expect(outcome.mapped[0].source).toBe("fallback");
    // A fallback unit was never reserved, so it has nothing to point a
    // stored decision's llm_call_id at -- N4's conflict proposals store
    // this alongside every accepted suggestion.
    expect(outcome.mapped[0].callLogId).toBeNull();
    // A denied reservation must never reach callModel or logCall.
    expect(deps.callModel).not.toHaveBeenCalled();
    expect(deps.logCall).not.toHaveBeenCalled();
  });

  it("counts a parse failure separately from an ordinary model failure, and still falls back", async () => {
    const callModel = vi.fn().mockResolvedValueOnce(okResponse("this is not json"));
    const deps = baseDeps({ callModel });
    const spec = baseSpec({ units: [{ id: "u1" }] });

    const outcome = await runMapReduce(spec, deps);

    expect(outcome.degradation.mapParseFailed).toBe(1);
    expect(outcome.degradation.mapFallback).toBe(1);
    expect(outcome.mapped[0].source).toBe("fallback");
  });

  it("drops claims that fail verification and counts the reason, keeping only what survives", async () => {
    const callModel = vi
      .fn()
      .mockResolvedValueOnce(okResponse('[{"value":5},{"value":-3}]'))
      .mockResolvedValueOnce(okResponse('[{"total":1}]'));
    const deps = baseDeps({ callModel });
    const spec = baseSpec({ units: [{ id: "u1" }] });

    const outcome = await runMapReduce(spec, deps);

    expect(outcome.mapped[0].claims).toEqual([{ value: 5 }]);
    expect(outcome.degradation.mapClaimsProposed).toBe(2);
    expect(outcome.degradation.mapClaimsKept).toBe(1);
    expect(outcome.degradation.dropReasons).toEqual({ negative_value: 1 });
  });

  it("reduceViaLlm: false runs the deterministic reduce and never calls the model for it", async () => {
    const callModel = vi.fn().mockResolvedValueOnce(okResponse('[{"value":1}]'));
    const reduceFallback = vi.fn(() => [{ total: 42 }]);
    const deps = baseDeps({ callModel });
    const spec = baseSpec({ units: [{ id: "u1" }], reduceViaLlm: false, reduceFallback });

    const outcome = await runMapReduce(spec, deps);

    expect(outcome.claims).toEqual([{ total: 42 }]);
    expect(outcome.degradation.reduceMode).toBe("pure");
    expect(callModel).toHaveBeenCalledTimes(1); // only the map call -- reduce never touches the model
    expect(reduceFallback).toHaveBeenCalledOnce();
  });

  it("falls back the reduce step on a model failure, marking reduceMode as fallback not pure", async () => {
    const callModel = vi
      .fn()
      .mockResolvedValueOnce(okResponse('[{"value":1}]'))
      .mockRejectedValueOnce(new Error("Gemini request failed: 503"));
    const reduceFallback = vi.fn((mapped: MappedUnit<Unit, MapClaim>[]) => [
      { total: mapped.reduce((s, m) => s + m.claims.length, 0) },
    ]);
    const deps = baseDeps({ callModel });
    const spec = baseSpec({ units: [{ id: "u1" }], reduceFallback });

    const outcome = await runMapReduce(spec, deps);

    expect(outcome.degradation.reduceMode).toBe("fallback");
    expect(outcome.claims).toEqual([{ total: 1 }]);
  });

  it("marks reduceMode budget_denied distinctly from fallback when the reduce reservation is denied", async () => {
    const reserve = vi
      .fn()
      .mockResolvedValueOnce({ granted: true, callLogId: "log-1" } satisfies ReservationDecision)
      .mockResolvedValueOnce({ granted: false, reason: "daily_cap" } satisfies ReservationDecision);
    const callModel = vi.fn().mockResolvedValueOnce(okResponse('[{"value":1}]'));
    const deps = baseDeps({ callModel, reserve });
    const spec = baseSpec({ units: [{ id: "u1" }] });

    const outcome = await runMapReduce(spec, deps);

    expect(outcome.degradation.reduceMode).toBe("budget_denied");
  });

  it("throws a clear configuration error if reduceViaLlm is true but the LLM reduce functions are missing", async () => {
    const deps = baseDeps({ callModel: vi.fn().mockResolvedValueOnce(okResponse("[]")) });
    const spec = baseSpec({
      units: [{ id: "u1" }],
      buildReducePrompt: undefined,
      parseReduceResponse: undefined,
      verifyReduceClaims: undefined,
    });

    await expect(runMapReduce(spec, deps)).rejects.toThrow(/missing buildReducePrompt/);
  });

  it("logs every real model call attempt (map and reduce), and never logs a denied reservation", async () => {
    const callModel = vi
      .fn()
      .mockResolvedValueOnce(okResponse('[{"value":1}]'))
      .mockResolvedValueOnce(okResponse('[{"total":1}]'));
    const logCall = vi.fn(async () => undefined);
    const deps = baseDeps({ callModel, logCall });
    const spec = baseSpec({ units: [{ id: "u1" }] });

    await runMapReduce(spec, deps);

    expect(logCall).toHaveBeenCalledTimes(2);
    expect(logCall).toHaveBeenNthCalledWith(1, expect.objectContaining({ status: "ok", surface: "rumours" }));
    expect(logCall).toHaveBeenNthCalledWith(2, expect.objectContaining({ status: "ok", surface: "rumours" }));
  });
});
