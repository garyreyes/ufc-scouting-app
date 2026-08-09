export interface Fighter {
  id: string;
  name: string;
  height_cm: number | null;
  reach_cm: number | null;
  weight_class: string | null;
  stance: string | null;
  wins: number;
  losses: number;
  draws: number;
}

export interface FighterFightHistoryEntry {
  id: string;
  weight_class: string | null;
  method: string | null;
  round: number | null;
  winner_id: string | null;
  event: { id: string; name: string; event_date: string };
  fighter1: { id: string; name: string };
  fighter2: { id: string; name: string };
}
