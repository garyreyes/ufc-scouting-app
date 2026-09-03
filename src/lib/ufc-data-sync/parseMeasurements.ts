// Extracted from fetchFighter.ts (I2) once a second caller
// (searchFighters.ts) needed the identical parsing -- one definition of
// "how the API's imperial strings become the metric columns this app
// actually stores," not two copies drifting apart.

// API returns "6' 0'" (feet' inches')
export function parseHeightToCm(height: string | null): number | null {
  const match = height?.match(/(\d+)'\s*(\d+)/);
  if (!match) return null;
  const [, feet, inches] = match;
  return Math.round(Number(feet) * 30.48 + Number(inches) * 2.54);
}

// API returns "66'" (inches only)
export function parseReachToCm(reach: string | null): number | null {
  const match = reach?.match(/(\d+)/);
  if (!match) return null;
  return Math.round(Number(match[1]) * 2.54);
}

// API returns "186 lbs"
export function parseWeightToKg(weight: string | null): number | null {
  const match = weight?.match(/(\d+)/);
  if (!match) return null;
  return Math.round(Number(match[1]) * 0.453592);
}
