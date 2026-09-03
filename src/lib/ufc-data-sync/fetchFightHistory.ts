import { apiSportsGet } from "./client";

interface ApiSportsFight {
  id: number;
  date: string;
  slug: string;
  category: string | null;
  fighters: {
    first: { id: number; winner: boolean };
    second: { id: number; winner: boolean };
  };
}

export interface FightHistoryEntry {
  externalFightId: string;
  eventSlug: string;
  eventDate: string;
  weightClass: string | null;
  fighter1ExternalId: string;
  fighter2ExternalId: string;
  winnerExternalId: string | null;
}

// The API has no promotion/org filter -- UFC cards are identified by the
// event slug (e.g. "UFC Fight Night: Gamrot vs Salkilld").
function isUfcEvent(slug: string): boolean {
  return slug.toUpperCase().startsWith("UFC");
}

// Shared by both fetch functions below -- one date-scoped (the existing
// recent-results sync), one fighter+season-scoped (I3's history
// backfill). Same underlying /fights resource, same shape, same UFC
// filter; only the query params differ.
function parseFightHistoryEntries(fights: ApiSportsFight[]): FightHistoryEntry[] {
  return fights
    .filter((fight) => isUfcEvent(fight.slug))
    .map((fight) => {
      const { first, second } = fight.fighters;
      const winner = first.winner ? first : second.winner ? second : null;

      return {
        externalFightId: String(fight.id),
        eventSlug: fight.slug,
        eventDate: fight.date.slice(0, 10),
        weightClass: fight.category,
        fighter1ExternalId: String(first.id),
        fighter2ExternalId: String(second.id),
        winnerExternalId: winner ? String(winner.id) : null,
      };
    });
}

export async function fetchFightHistory(date: string): Promise<FightHistoryEntry[]> {
  const fights = await apiSportsGet<ApiSportsFight[]>("fights", { date });
  return parseFightHistoryEntries(fights);
}

// I3: a fighter's own fight history for one season. The free tier only
// serves 2022-2024 (found live, G1b -- 2025/2026 are refused outright:
// "Free plans do not have access to this season, try from 2022 to
// 2024"), so callers should only ever pass one of those three years.
export async function fetchFighterSeasonHistory(
  externalFighterId: string,
  season: string,
): Promise<FightHistoryEntry[]> {
  const fights = await apiSportsGet<ApiSportsFight[]>("fights", { fighter: externalFighterId, season });
  return parseFightHistoryEntries(fights);
}
