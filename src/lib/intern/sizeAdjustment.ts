// L3: how far a reach (or, failing that, height) edge shades the market
// anchor, in the same additive-adjustment shape flagPenalty.ts and
// eloAdjustment.ts already use. Deliberately the WEAKEST-capped signal of
// the three -- it is the least-established piece of evidence here (no
// win-rate direction has ever been measured against this app's own data,
// unlike Elo, which is derived from real UFC results). First dial to turn
// if it turns out wrong, same humility flagPenalty.ts's constants state.
export const MAX_SIZE_ADJUSTMENT = 0.06;

// The reach/height gap, in cm, at which the signal reaches its cap. 15cm
// is a large-but-real edge in a single weight class (bigger gaps do
// happen -- heavyweight, or a short-notice mismatch -- and are simply
// clamped, not treated as more extreme).
export const SIZE_ADJUSTMENT_FULL_CM = 15;

export interface SizeMeasurements {
  reachCm: number | null;
  heightCm: number | null;
}

function clampToCap(rawDelta: number): number {
  return Math.max(-MAX_SIZE_ADJUSTMENT, Math.min(MAX_SIZE_ADJUSTMENT, rawDelta));
}

/**
 * A bounded, signed probability-point shift toward the fighter with the
 * size edge -- positive toward fighter1, negative toward fighter2.
 *
 * Reach is preferred whenever BOTH fighters have it (the better predictor
 * for striking range); height is used only when that is not the case AND
 * both fighters have a height. It never compares one fighter's reach
 * against the other's height -- that is not a real measurement of either
 * fighter's size edge, just noise -- so any other combination of missing
 * data returns exactly 0.
 */
export function sizeAdjustment(fighter1: SizeMeasurements, fighter2: SizeMeasurements): number {
  if (fighter1.reachCm !== null && fighter2.reachCm !== null) {
    return clampToCap(((fighter1.reachCm - fighter2.reachCm) / SIZE_ADJUSTMENT_FULL_CM) * MAX_SIZE_ADJUSTMENT);
  }
  if (fighter1.heightCm !== null && fighter2.heightCm !== null) {
    return clampToCap(((fighter1.heightCm - fighter2.heightCm) / SIZE_ADJUSTMENT_FULL_CM) * MAX_SIZE_ADJUSTMENT);
  }
  return 0;
}
