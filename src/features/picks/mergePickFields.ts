import type { PickFields } from "./types";

// Both save actions (QuickPick's fast path, BetRow's expanded fields)
// write a *partial* shape of a picks row. Supabase's upsert only knows
// what's in the payload -- so the actions themselves read-merge-write
// through this function rather than each sending a partial object
// straight to .upsert(), which would risk the next surface's fields
// silently reverting to their column defaults on conflict. A data-merging
// rule (ARCHITECTURE.md's correctness-critical list), so it gets the same
// test-first treatment as the settlement math.
export function mergePickFields(existing: PickFields | null, updates: Partial<PickFields>): PickFields {
  const base: Partial<PickFields> = existing ?? {};
  const { predictedFighterId, estimatedProbability, confidence, ...rest } = { ...base, ...updates };

  if (predictedFighterId === undefined || estimatedProbability === undefined || confidence === undefined) {
    const missing = [
      predictedFighterId === undefined ? "predictedFighterId" : null,
      estimatedProbability === undefined ? "estimatedProbability" : null,
      confidence === undefined ? "confidence" : null,
    ].filter((name): name is string => name !== null);
    throw new Error(
      `Cannot save a pick without an existing row and no ${missing.join(", ")} in the update -- ` +
        "a bet or an expanded-row edit can't create a pick out of thin air.",
    );
  }

  return {
    predictedFighterId,
    estimatedProbability,
    confidence,
    predictedMethod: rest.predictedMethod ?? null,
    reasoning: rest.reasoning ?? null,
    betFighterId: rest.betFighterId ?? null,
    stakeUnits: rest.stakeUnits ?? null,
  };
}
