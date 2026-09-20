import type { SupabaseClient } from "@supabase/supabase-js";
import { runMapReduce } from "../llm/runMapReduce";
import { verifyClaims } from "../llm/verifyClaims";
import type { Degradation, MapReduceDeps, MapReduceSpec } from "../llm/runMapReduce";
import { applyShadowPickClaims } from "./applyShadowPickClaims";
import { buildShadowPicksPrompt } from "./buildShadowPicksPrompt";
import { fetchShadowPickCard } from "./fetchShadowPickCard";
import { parseShadowPicksResponse } from "./parseShadowPicksResponse";
import { shadowPickClaimChecks } from "./shadowPickClaimChecks";
import type { ShadowPickClaim, ShadowPickFacts, ShadowPickFightFacts, ShadowPickResult } from "./types";

export interface GenerateShadowPicksGroqSummary {
  eligibleFights: number;
  ran: boolean; // false when no dossier changed since the last run -- not a degradation, an intended skip
  shadowPicksWritten: number;
  degradation: Degradation | null;
}

function buildSpec(
  fights: ShadowPickFightFacts[],
  eventId: string,
): MapReduceSpec<ShadowPickFightFacts, ShadowPickClaim, ShadowPickResult, ShadowPickFacts> {
  const facts: ShadowPickFacts = { eventId, fightsById: new Map(fights.map((f) => [f.fightId, f])) };

  return {
    surface: "shadowPicks",
    // O3 (Track B): one unit PER FIGHT, not the whole card -- the real
    // difference from generateShadowPicks.ts's Gemini spec. Groq's 8000
    // TPM budget can't fit a whole-card prompt (DECISIONS.md, 2026-09-19),
    // but a live spike (PROJECT_FACTS.md, 2026-09-20) confirmed a single
    // fight's prompt fits with ~4x headroom, reusing
    // buildShadowPicksPrompt.ts UNCHANGED with a length-1 array -- its
    // response shape (`{"picks": [...]}`) already tolerates any length.
    units: fights,
    facts,
    buildMapPrompt: (fight) => buildShadowPicksPrompt([fight]),
    parseMapResponse: (text) => parseShadowPicksResponse(JSON.parse(text)),
    verifyMapClaims: (claims, _unit, f) => verifyClaims(claims, f, shadowPickClaimChecks),
    // No evidence, no shadow pick this run for that fight -- same "never
    // substitute a heuristic row" rule generateShadowPicks.ts's own
    // mapFallback documents. A per-fight fallback here only drops THAT
    // fight, not the whole card, unlike Gemini's single-unit spec where
    // a map failure means the whole card gets nothing.
    mapFallback: () => [],
    reduceViaLlm: false,
    reduceFallback: (mapped, f) => applyShadowPickClaims(mapped, f, "groq"),
  };
}

/**
 * O3 (Track B)'s Groq counterpart to generateShadowPicks.ts -- same
 * `fetchShadowPickCard`/`applyShadowPickClaims`/`shadowPickClaimChecks`,
 * same append-only `shadow_picks` write, but one call PER FIGHT
 * (~11-14 calls per card) instead of one call for the whole card, since
 * Groq's free tier can't fit a whole-card prompt. `provider: "groq"`
 * lets `selectLatestBeforeLock.ts` (0061) keep this stream distinct from
 * Gemini's `generateShadowPicks.ts` writes for the exact same fight/line.
 */
export async function generateShadowPicksGroq(
  supabase: SupabaseClient,
  deps: MapReduceDeps,
): Promise<GenerateShadowPicksGroqSummary> {
  const card = await fetchShadowPickCard(supabase, "groq");
  if (card === null) {
    return { eligibleFights: 0, ran: false, shadowPicksWritten: 0, degradation: null };
  }
  if (!card.needsRun) {
    return { eligibleFights: card.fights.length, ran: false, shadowPicksWritten: 0, degradation: null };
  }

  const outcome = await runMapReduce(buildSpec(card.fights, card.eventId), deps);

  let shadowPicksWritten = 0;
  for (const result of outcome.claims) {
    const { error } = await supabase.from("shadow_picks").insert({
      fight_id: result.fightId,
      line: result.line,
      provider: result.provider,
      predicted_fighter_id: result.predictedFighterId,
      probability: result.probability,
      confidence: result.confidence,
      signals: result.signals,
      reasoning: result.reasoning,
      llm_call_id: result.llmCallId,
    });
    if (error) throw error;
    shadowPicksWritten++;
  }

  return {
    eligibleFights: card.fights.length,
    ran: true,
    shadowPicksWritten,
    degradation: outcome.degradation,
  };
}
