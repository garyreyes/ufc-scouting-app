// Shared shapes for the F2 rumour-clustering pipeline. RumourCategory
// mirrors 0024_rumour_flags_and_sources.sql's check constraint exactly --
// 'other' included alongside the PRD's four named concern types so a real,
// corroborated concern that doesn't fit those four still gets surfaced
// rather than silently dropped (confirmed with the user 2026-09-02).
export type RumourCategory =
  | "weight_cut"
  | "injury"
  | "camp_change"
  | "short_notice_replacement"
  | "other";

export const RUMOUR_CATEGORIES: readonly RumourCategory[] = [
  "weight_cut",
  "injury",
  "camp_change",
  "short_notice_replacement",
  "other",
];

// One fighter in the specific fight being scanned -- never the whole
// fighters table. Matching is deliberately scoped to just these two: PRD's
// "ambiguous mentions are dropped, not guessed" warning (Silva, Rodriguez,
// Nurmagomedov) is about false-matching a DIFFERENT fighter of the same
// surname, and scoping candidates to one bout's own two fighters -- rather
// than the full roster -- already closes most of that risk at the source.
export interface FighterCandidate {
  id: string;
  name: string;
}

// lib/bluesky.ts's BlueskyPost, trimmed to what clustering actually
// consumes -- kept as a separate local type rather than importing
// BlueskyPost directly so this module doesn't couple to lib/bluesky.ts's
// shape beyond what it uses.
export interface CandidatePost {
  uri: string;
  authorHandle: string;
  text: string;
  externalUrl: string | null;
  createdAt: string;
}

// One clustered concern, already resolved to a specific fighter and
// backed by the real source posts it was built from -- the output shape
// both heuristicCluster.ts and parseClusterResponse.ts produce, so
// scanFightForRumours.ts can write either one identically.
export interface ClusteredFlag {
  fighterId: string;
  category: RumourCategory;
  summary: string;
  sources: CandidatePost[];
}

// Phase N3: shared shapes for the card-level retraction pass
// (fetchOpenFlagsForRetraction.ts, buildRetractionPrompt.ts,
// parseRetractionResponse.ts, retractionChecks.ts, proposeCardRetractions.ts).

// One currently-open flag as retraction-checking needs it -- both
// fighters (not just the flagged one) so a superseding post's text can be
// checked against the SAME two-candidate scoping matchFighterMention.ts
// already uses, never a name-match against the wider roster.
export interface OpenFlagForRetraction {
  id: string;
  fightId: string;
  fighterId: string;
  fighter1: FighterCandidate;
  fighter2: FighterCandidate;
  category: RumourCategory;
  summary: string;
  // max(rumour_sources.post_created_at) across this flag's real sources --
  // never first_detected_at/last_corroborated_at, which can move for
  // reasons unrelated to when the evidence was actually posted.
  mostRecentSourceAt: string;
}

// The model's per-flag decision, before any ground-truth check has run --
// see retractionChecks.ts for what "real" means for each field.
export interface RetractionClaim {
  flagId: string;
  action: "keep" | "retract";
  supersededByUri: string | null;
  rationale: string;
}
