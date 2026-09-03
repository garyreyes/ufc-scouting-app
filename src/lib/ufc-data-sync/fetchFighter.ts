import { apiSportsGet } from "./client";
import { parseHeightToCm, parseReachToCm } from "./parseMeasurements";

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
