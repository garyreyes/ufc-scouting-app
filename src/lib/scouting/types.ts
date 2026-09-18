// Shared shapes for N7's scouting-dossier pipeline
// (fetchFightersNeedingDossiers.ts, buildScoutingDossierPrompt.ts,
// parseScoutingDossierResponse.ts, scoutingDossierChecks.ts,
// generateScoutingDossiers.ts). Mirrors lib/conflictProposals' own file
// layout, which mirrors lib/rumours'.

export const RECENT_BOUT_WINDOW = 5;

export interface ScoutingRecentBout {
  id: string;
  result: "win" | "loss" | "draw" | "nc" | "unknown";
  opponentName: string;
  eventName: string | null;
  eventDate: string | null;
  method: string | null;
}

export interface ScoutingOpenFlag {
  id: string;
  category: string;
  summary: string;
}

/**
 * The exact, complete set of fields the scouting prompt is built from.
 * `computeScoutingInputHash.ts` hashes this WHOLE object canonically --
 * not a hand-picked subset of its fields -- which is what forecloses the
 * plan's own named risk ("cache key omits a field the prompt uses ->
 * stale dossiers served forever, invisibly") structurally rather than by
 * convention: `buildScoutingDossierPrompt.ts` can only ever read from a
 * `ScoutingFighterBundle`, and the hash already covers every field of it.
 * There is no second, hand-maintained field list for the two to drift
 * apart from.
 */
export interface ScoutingFighterBundle {
  fighterId: string;
  name: string;
  eloRating: number;
  ratedFightCount: number;
  reachCm: number | null;
  heightCm: number | null;
  // Birth date, not age -- age changes every single day regardless of
  // anything real changing about the fighter, which would invalidate
  // every dossier's cache daily for no reason. birthDate itself is
  // immutable once known.
  birthDate: string | null;
  sherdogWinsByKo: number | null;
  sherdogWinsBySub: number | null;
  sherdogWinsByDec: number | null;
  sherdogLossesByKo: number | null;
  sherdogLossesBySub: number | null;
  sherdogLossesByDec: number | null;
  // Sherdog's own most-recent-first order, capped at RECENT_BOUT_WINDOW.
  recentBouts: ScoutingRecentBout[];
  openFlags: ScoutingOpenFlag[];
}

// The model's per-fighter dossier, before ground-truth checking.
export interface ScoutingDossierClaim {
  fighterId: string;
  formTrajectory: string;
  stylisticProfile: string;
  durability: string;
  layoff: string;
  // Evidence refs the checks verify are real, per the plan's "each claim
  // carrying explicit evidence refs" -- a claim citing a bout or flag id
  // that isn't in this fighter's own bundle is dropped whole, not
  // narrowed: a fabricated citation means the prose around it may already
  // be reasoning from something that doesn't exist, which is disqualifying
  // for the whole dossier, not just the citation list.
  citedBoutIds: string[];
  citedFlagIds: string[];
}

// One fighter needing a fresh dossier this run -- its bundle plus the
// hash already computed from it, so the map step never recomputes it.
export interface FighterNeedingDossier {
  bundle: ScoutingFighterBundle;
  inputHash: string;
}
