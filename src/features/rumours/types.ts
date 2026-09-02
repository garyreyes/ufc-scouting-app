// Type-only import from lib/rumours -- the domain concept (what a concern
// category IS) is defined once, in the job that writes it; this feature
// only reads. A type import has no runtime code, so this crosses no layer
// boundary (CLAUDE.md: UI/features make no external calls -- there isn't
// one here, just a shared vocabulary).
import type { RumourCategory } from "@/lib/rumours/types";

export type { RumourCategory };

// Card-view badge data (BoutRow): enough to show a flag exists and what
// kind, without every source link -- that's RumourFlagDetail's job, for
// /fights/[id]. corroborationCount is always computed from real
// rumour_sources rows (count(*) at read time, never a stored number --
// 0024_rumour_flags_and_sources.sql's own rule), same discipline the
// scoreboard's chalk line follows.
export interface RumourFlagSummary {
  id: string;
  fighterId: string;
  category: RumourCategory;
  summary: string;
  corroborationCount: number;
  lastCorroboratedAt: string;
}

export interface RumourSourceDetail {
  uri: string;
  authorHandle: string;
  excerpt: string;
  externalUrl: string | null;
  isNamedSource: boolean;
  postCreatedAt: string;
}

// /fights/[id]'s full rumour section: every real source backing the flag,
// links included -- PRD UC-1's "direct links to each post" requirement.
export interface RumourFlagDetail extends RumourFlagSummary {
  sources: RumourSourceDetail[];
}
