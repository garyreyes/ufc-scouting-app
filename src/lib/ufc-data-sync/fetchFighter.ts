import { apiSportsGet } from "./client";

interface ApiSportsFighter {
  id: number;
  name: string;
  height: string | null;
  reach: string | null;
  stance: string | null;
  category: string | null;
}

export interface FighterRow {
  external_id: string;
  name: string;
  height_cm: number | null;
  reach_cm: number | null;
  weight_class: string | null;
  stance: string | null;
  synced_at: string;
}

// API returns "6' 0'" (feet' inches')
function parseHeightToCm(height: string | null): number | null {
  const match = height?.match(/(\d+)'\s*(\d+)/);
  if (!match) return null;
  const [, feet, inches] = match;
  return Math.round(Number(feet) * 30.48 + Number(inches) * 2.54);
}

// API returns "66'" (inches only)
function parseReachToCm(reach: string | null): number | null {
  const match = reach?.match(/(\d+)/);
  if (!match) return null;
  return Math.round(Number(match[1]) * 2.54);
}

export async function fetchFighter(apiSportsId: number): Promise<FighterRow | null> {
  const fighters = await apiSportsGet<ApiSportsFighter[]>("fighters", {
    id: String(apiSportsId),
  });
  const fighter = fighters[0];
  if (!fighter) return null;

  return {
    external_id: String(fighter.id),
    name: fighter.name,
    height_cm: parseHeightToCm(fighter.height),
    reach_cm: parseReachToCm(fighter.reach),
    weight_class: fighter.category,
    stance: fighter.stance,
    synced_at: new Date().toISOString(),
  };
}
