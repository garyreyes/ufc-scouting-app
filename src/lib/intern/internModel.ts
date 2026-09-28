// Phase S (ROADMAP_V2.md): the Intern's model version, as data rather than
// a code fork. v1 is the original "market + full signal delta" read; v2
// trusts the signals only `signalWeight` of the way, because over the
// first 49 priced fights v1's full-strength signals were worse than the
// bare market (Brier 0.237 vs 0.226). Stored on every pick as
// signals.modelVersion so the scoreboard can split the two records.

export type InternModelVersion = "v1" | "v2";

export interface InternModelParams {
  version: InternModelVersion;
  // Fraction of the (already MAX_TOTAL_ADJUSTMENT-clamped) signal delta
  // applied on top of the de-vigged market anchor.
  signalWeight: number;
  minProbability: number;
  maxProbability: number;
}

export const INTERN_V1: InternModelParams = {
  version: "v1",
  signalWeight: 1,
  minProbability: 0.01,
  maxProbability: 0.99,
};

// signalWeight 0.35 caps a full-strength signal stack at ±8.75 points off
// the market. The backtest (npm run intern:backtest) can veto this value;
// it is deliberately not tuned to the 49-fight sample.
export const INTERN_V2: InternModelParams = {
  version: "v2",
  signalWeight: 0.35,
  minProbability: 0.03,
  maxProbability: 0.97,
};

export const CURRENT_INTERN_MODEL = INTERN_V2;

export function applyInternDelta(anchor1: number, clampedDelta: number, params: InternModelParams): number {
  const raw = anchor1 + params.signalWeight * clampedDelta;
  return Math.min(params.maxProbability, Math.max(params.minProbability, raw));
}

// picks.signals is untyped jsonb -- a pick written before Phase S has no
// modelVersion at all, and anything unrecognised is treated as v1 rather
// than silently joining the v2 record.
export function modelVersionOf(signals: unknown): InternModelVersion {
  if (typeof signals === "object" && signals !== null && (signals as { modelVersion?: unknown }).modelVersion === "v2") {
    return "v2";
  }
  return "v1";
}
