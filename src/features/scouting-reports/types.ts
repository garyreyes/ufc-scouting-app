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
