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
  // Sherdog's own finish-method breakdown (J4). Null when this fighter
  // has no sherdog_id or the breakdown didn't reconcile with the headline.
  sherdog_wins_by_ko: number | null;
  sherdog_wins_by_sub: number | null;
  sherdog_wins_by_dec: number | null;
  sherdog_losses_by_ko: number | null;
  sherdog_losses_by_sub: number | null;
  sherdog_losses_by_dec: number | null;
  // Set once the Sherdog history import (J4) ran for this fighter. When
  // set, wins/losses/draws above are the FULL career record (J5), not
  // the app's partial fight-graph count.
  sherdog_history_imported_at: string | null;
}

// One row from fighter_sherdog_bouts (J4) -- a fighter's full career as
// Sherdog records it, opponent/event by name + Sherdog id, no FKs.
export interface SherdogBout {
  bout_order: number;
  result: "win" | "loss" | "draw" | "nc" | "unknown";
  opponent_name: string;
  opponent_sherdog_id: number | null;
  event_name: string | null;
  event_date: string | null;
  method: string | null;
  round: number | null;
  bout_time: string | null;
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
