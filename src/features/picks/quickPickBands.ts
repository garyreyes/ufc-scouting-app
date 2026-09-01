// A quick pick still needs a real, independent estimated_probability --
// it's required on every picks row (0019_picks.sql) and feeds the
// calibration check (docs/PRD.md), so it can't be silently defaulted.
// These presets are what keep "tap a fighter" close to one tap without
// faking the number: a genuine, if coarse, independent judgment rather
// than a number borrowed from the market (that would make the
// calibration check tautological -- see PROJECT_FACTS.md) or an
// arbitrarily precise one nobody can produce cold.
//
// Deliberately NOT anchored to this fight's own implied probability --
// unlike C4's bet row, a pick is pure opinion, independent of price
// (docs/PRD.md: "a pick says who wins, no money").
export interface ProbabilityBand {
  label: string;
  probability: number;
}

export const QUICK_PICK_BANDS: ProbabilityBand[] = [
  { label: "Slight edge", probability: 0.55 },
  { label: "Clear favorite", probability: 0.65 },
  { label: "Strong favorite", probability: 0.75 },
  { label: "Heavy favorite", probability: 0.85 },
  { label: "Near-lock", probability: 0.95 },
];

// A quick pick's confidence defaults to this neutral midpoint rather than
// asking -- unlike estimated_probability, confidence feeds no P&L/edge
// math (docs/PRD.md; ARCHITECTURE.md items #1/#2 name only probability
// and price), so defaulting it costs nothing the way faking a
// probability would. Editable later once C4's expanded row exists.
export const DEFAULT_QUICK_PICK_CONFIDENCE = 3;
