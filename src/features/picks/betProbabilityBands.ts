// The anchored-probability control for C4's expanded row (user-confirmed
// choice over a slider/stepper): the same one-tap band interaction C3
// already shipped, but the bands are *relative to the market's implied
// probability* instead of C3's absolute 55/65/75/85/95% -- so the
// judgment being made really is "is the market too high or low, and by
// how much" (ROADMAP.md's own framing for why C4 exists), not a second
// guess made cold. Deltas are applied via lib/scoring/applyProbabilityDelta.ts,
// which clamps the result into 0019_picks.sql's (0, 1) constraint.
export interface BetProbabilityBand {
  label: string;
  delta: number;
}

export const BET_PROBABILITY_BANDS: BetProbabilityBand[] = [
  { label: "Well below market", delta: -0.1 },
  { label: "Below market", delta: -0.05 },
  { label: "At market", delta: 0 },
  { label: "Above market", delta: 0.05 },
  { label: "Well above market", delta: 0.1 },
];

// Recognition over recall (the UX floor): reopening the bet row highlights
// whichever band the *current* estimated_probability is closest to,
// rather than always resetting to "At market" and making the user
// re-derive what they last said.
export function nearestBetProbabilityBand(
  impliedProbability: number,
  estimatedProbability: number,
): BetProbabilityBand {
  const actualDelta = estimatedProbability - impliedProbability;
  return BET_PROBABILITY_BANDS.reduce((closest, band) =>
    Math.abs(band.delta - actualDelta) < Math.abs(closest.delta - actualDelta) ? band : closest,
  );
}
