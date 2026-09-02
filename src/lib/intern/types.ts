import type { RumourCategory } from "../rumours/types";

export interface InternFighter {
  id: string;
  name: string;
}

// One flag as the intern consumes it -- only what the adjustment rule
// actually reads. corroborationCount is the real count of rumour_sources
// rows (features/rumours/api.ts computes it at read time), never a stored
// number.
export interface InternFlag {
  fighterId: string;
  category: RumourCategory;
  corroborationCount: number;
}

export interface InternPickInput {
  fighter1: InternFighter;
  fighter2: InternFighter;
  // null when the fight has no odds_snapshot yet. The intern still picks
  // (user-confirmed 2026-09-02) -- it just anchors at even odds instead
  // of a market price, and says so in its reasoning. docs/PRD.md's
  // scoreboard already handles unpriced picks: counted in accuracy,
  // excluded from units.
  odds: { fighter1Price: number; fighter2Price: number } | null;
  flags: InternFlag[];
}

export interface InternPickDecision {
  predictedFighterId: string;
  estimatedProbability: number;
  confidence: number;
  reasoning: string;
  // Recorded so a later calibration pass (G3) can separate the intern's
  // market-anchored calls from its unanchored ones -- they are not the
  // same quality of prediction and averaging them together would hide
  // that.
  marketAnchored: boolean;
}
