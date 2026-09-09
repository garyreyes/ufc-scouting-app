import type { SherdogBio } from "./parseFighterPage";

// J6: Sherdog's bio height/weight fill fighters.height_cm / weight_kg,
// but ONLY where the column is currently null -- never overwrite a value
// API-Sports (or a prior run) already set. Sherdog has no reach and no
// stance, so those stay API-Sports' job.
//
// Returns only the keys worth writing, so the caller can spread it into
// an update payload without producing a no-op write for a fighter who
// already has both.
export function bioFillPayload(
  current: { height_cm: number | null; weight_kg: number | null },
  bio: Pick<SherdogBio, "heightCm" | "weightKg">,
): { height_cm?: number; weight_kg?: number } {
  const out: { height_cm?: number; weight_kg?: number } = {};
  if (current.height_cm === null && bio.heightCm !== null) out.height_cm = bio.heightCm;
  if (current.weight_kg === null && bio.weightKg !== null) out.weight_kg = bio.weightKg;
  return out;
}
