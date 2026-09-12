// L3-age: a peak-age curve, same additive-adjustment shape as
// sizeAdjustment.ts. Deliberately the WEAKEST-capped intern signal: the
// window edges and the youth weight are unmeasured assumptions layered on
// a direction this app has never checked against its own results. First
// dials to turn, in order: the cap, the window, the youth weight
// (DECISIONS.md, 2026-09-12).
export const MAX_AGE_ADJUSTMENT = 0.04;

export const PEAK_AGE_LOW = 27;
export const PEAK_AGE_HIGH = 32;

// Years below the window count half: a young fighter is still improving,
// while post-peak decline is the better-documented effect.
export const YOUTH_WEIGHT = 0.5;

// The weighted gap in distance-from-peak at which the signal hits its cap.
export const AGE_ADJUSTMENT_FULL_YEARS = 8;

function distanceFromPeak(age: number): number {
  if (age < PEAK_AGE_LOW) return (PEAK_AGE_LOW - age) * YOUTH_WEIGHT;
  if (age > PEAK_AGE_HIGH) return age - PEAK_AGE_HIGH;
  return 0;
}

/**
 * A bounded, signed probability-point shift toward whichever fighter sits
 * closer to peak age -- positive toward fighter1, negative toward fighter2.
 * Exactly 0 when either age is unknown: one fighter's age alone is not a
 * comparison.
 */
export function ageAdjustment(age1: number | null, age2: number | null): number {
  if (age1 === null || age2 === null) return 0;
  const raw = ((distanceFromPeak(age2) - distanceFromPeak(age1)) / AGE_ADJUSTMENT_FULL_YEARS) * MAX_AGE_ADJUSTMENT;
  return Math.max(-MAX_AGE_ADJUSTMENT, Math.min(MAX_AGE_ADJUSTMENT, raw));
}
