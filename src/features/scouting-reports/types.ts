export type ReportVisibility = "PRIVATE" | "SPECIFIC_CLANS" | "ALL_MY_CLANS";

export interface ScoutingReport {
  id: string;
  fight_id: string;
  user_id: string;
  body: string;
  visibility: ReportVisibility;
  created_at: string;
  author_name: string | null;
}

// Attached to a fighter directly (e.g. "good wrestling"), not to one
// specific bout -- shows on every fight page that fighter appears in,
// and on their profile.
export interface FighterScoutingReport {
  id: string;
  fighter_id: string;
  user_id: string;
  body: string;
  visibility: ReportVisibility;
  created_at: string;
  author_name: string | null;
}
