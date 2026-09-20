// Shared shapes for N8's shadow-picks pipeline (fetchShadowPickCard.ts,
// buildShadowPicksPrompt.ts, parseShadowPicksResponse.ts,
// shadowPickClaimChecks.ts, applyShadowPickClaims.ts,
// generateShadowPicks.ts). Mirrors lib/scouting's own file layout (N7).

import type { ScoutingOpenFlag, ScoutingRecentBout } from "../scouting/types";

export interface ShadowPickDossierFacts {
  formTrajectory: string;
  stylisticProfile: string;
  durability: string;
  layoff: string;
}

// Everything the prompt (buildShadowPicksPrompt.ts) reads about one
// fighter, and everything shadowPickClaimChecks.ts checks a claim's
// numeric restatement and citations against.
export interface ShadowPickFighterFacts {
  fighterId: string;
  name: string;
  eloRating: number;
  ratedFightCount: number;
  reachCm: number | null;
  heightCm: number | null;
  ageYears: number | null;
  sherdogWins: number;
  sherdogLosses: number;
  dossier: ShadowPickDossierFacts;
  recentBouts: ScoutingRecentBout[];
  openFlags: ScoutingOpenFlag[];
}

export interface ShadowPickFightFacts {
  fightId: string;
  fighter1: ShadowPickFighterFacts;
  fighter2: ShadowPickFighterFacts;
  // null when this fight has no odds snapshot yet -- Fork 10's own
  // "unpriced fights still get a pick, anchored at 50%" rule applies here
  // unchanged (applyShadowPickClaims.ts).
  fighter1Price: number | null;
  fighter2Price: number | null;
}

// One reduce call covers the whole card -- the plan's own reasoning for
// this (point 1, Budget section): a card-level call can reason about
// cross-fight consistency (one storyline affecting two bouts) a per-fight
// call structurally cannot see. There is exactly one unit per run.
export interface ShadowPickCardUnit {
  eventId: string;
}

export interface ShadowPickFacts {
  eventId: string;
  fightsById: Map<string, ShadowPickFightFacts>;
}

// Signed deltas toward fighter1, same convention decideInternPick.ts's
// own `signals` use -- this is what makes the two comparable at all.
export interface ShadowPickDeltas {
  rumours: number;
  elo: number;
  size: number;
  age: number;
}

// The model's numeric restatement of every fact it was given, per
// fighter (plan: "every numeric restated in a claim ... matches the DB
// exactly -- the model was *given* these, so restating one wrong is a
// hard drop"). This is the cheapest and most valuable check in the
// phase, per the plan's own Risks section.
export interface ShadowPickNumericRestatement {
  fighter1Elo: number;
  fighter2Elo: number;
  fighter1Reach: number | null;
  fighter2Reach: number | null;
  fighter1Height: number | null;
  fighter2Height: number | null;
  fighter1Age: number | null;
  fighter2Age: number | null;
  fighter1Wins: number;
  fighter1Losses: number;
  fighter2Wins: number;
  fighter2Losses: number;
  fighter1Price: number | null;
  fighter2Price: number | null;
}

// The model's per-fight proposal, before ground-truth checking
// (shadowPickClaimChecks.ts). The model never emits a probability for
// the assisted line -- only these bounded signed deltas, applied through
// the existing `applyProbabilityDelta`/`MAX_TOTAL_ADJUSTMENT` clamp in
// applyShadowPickClaims.ts. `freeProbabilityFighter1` is the SEPARATE,
// unconstrained probability that becomes the LLM_ONLY line.
export interface ShadowPickClaim {
  fightId: string;
  restated: ShadowPickNumericRestatement;
  deltas: ShadowPickDeltas;
  freeProbabilityFighter1: number;
  citedBoutIds: string[];
  citedFlagIds: string[];
  reasoning: string;
}

export type ShadowPickLine = "LLM_ASSISTED" | "LLM_ONLY";

// The final row written to `shadow_picks` -- one claim produces two of
// these (applyShadowPickClaims.ts).
export interface ShadowPickResult {
  fightId: string;
  line: ShadowPickLine;
  // O3 (Track B): which model produced this row -- 'gemini' | 'groq',
  // matching `shadow_picks.provider`'s own check constraint (0061) --
  // same "small, explicit, checked set" convention this table's `line`
  // column already uses, not `llm_call_log.model_id`'s free-text one.
  provider: string;
  predictedFighterId: string;
  probability: number;
  // Only set on LLM_ASSISTED -- LLM_ONLY has no deterministic banding to
  // apply, since it never goes through decideInternPick's own signals.
  confidence: number | null;
  signals: (ShadowPickDeltas & { sumDelta: number }) | null;
  reasoning: string;
  llmCallId: string | null;
}
