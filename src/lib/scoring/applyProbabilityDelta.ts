// C4's anchored-probability control: the user picks a delta relative to
// the market's own implied probability ("well below market" .. "well
// above market") rather than an absolute number. This turns that delta
// into the actual estimated_probability value that gets stored --
// clamped strictly inside (0, 1), since 0019_picks.sql's check constraint
// is a strict open interval and a lopsided favourite/underdog plus a
// delta at either extreme would otherwise overflow past 0 or 1.
const MIN_PROBABILITY = 0.01;
const MAX_PROBABILITY = 0.99;

export function applyProbabilityDelta(impliedProbability: number, delta: number): number {
  const raw = impliedProbability + delta;
  return Math.min(MAX_PROBABILITY, Math.max(MIN_PROBABILITY, raw));
}
