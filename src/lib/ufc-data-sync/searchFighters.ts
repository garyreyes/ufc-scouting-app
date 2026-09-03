import { apiSportsGet } from "./client";
import { parseHeightToCm, parseReachToCm, parseWeightToKg } from "./parseMeasurements";

interface ApiSportsFighter {
  id: number;
  name: string;
  height: string | null;
  reach: string | null;
  weight: string | null;
  stance: string | null;
  category: string | null;
  nickname: string | null;
  team: { name: string | null } | null;
}

// The full record I2's verification spike found actually available --
// wider than fetchFighter.ts's FighterRow, since that one was written for
// the recent-results sync (id already known, height/reach/stance/weight
// class only) before nickname/team were ever going to matter to this
// app. Confirmed live 2026-09-03: the API returns no win/loss record at
// all, so that stays absent here too rather than a field this app
// pretends to have and never fills.
export interface FighterSearchCandidate {
  externalId: string;
  name: string;
  heightCm: number | null;
  reachCm: number | null;
  weightKg: number | null;
  weightClass: string | null;
  stance: string | null;
  nickname: string | null;
  team: string | null;
}

export async function searchFighters(name: string): Promise<FighterSearchCandidate[]> {
  const fighters = await apiSportsGet<ApiSportsFighter[]>("fighters", { search: name });

  return fighters.map((f) => ({
    externalId: String(f.id),
    name: f.name,
    heightCm: parseHeightToCm(f.height),
    reachCm: parseReachToCm(f.reach),
    weightKg: parseWeightToKg(f.weight),
    weightClass: f.category,
    stance: f.stance,
    nickname: f.nickname,
    team: f.team?.name ?? null,
  }));
}
