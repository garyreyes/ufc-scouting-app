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

export async function fetchFightHistory(date: string): Promise<FightHistoryEntry[]> {
  const fights = await apiSportsGet<ApiSportsFight[]>("fights", { date });

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
