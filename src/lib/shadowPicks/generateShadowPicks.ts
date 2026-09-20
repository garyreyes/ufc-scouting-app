import type { SupabaseClient } from "@supabase/supabase-js";
import { runMapReduce } from "../llm/runMapReduce";
import { verifyClaims } from "../llm/verifyClaims";
import type { Degradation, MapReduceDeps, MapReduceSpec } from "../llm/runMapReduce";
import { applyShadowPickClaims } from "./applyShadowPickClaims";
import { buildShadowPicksPrompt } from "./buildShadowPicksPrompt";
import { fetchShadowPickCard } from "./fetchShadowPickCard";
import type { ShadowPickCard } from "./fetchShadowPickCard";
import { parseShadowPicksResponse } from "./parseShadowPicksResponse";
import { shadowPickClaimChecks } from "./shadowPickClaimChecks";
import type { ShadowPickCardUnit, ShadowPickClaim, ShadowPickFacts, ShadowPickResult } from "./types";

export interface GenerateShadowPicksSummary {
  eligibleFights: number;
  ran: boolean; // false when no dossier changed since the last run -- not a degradation, an intended skip
  shadowPicksWritten: number;
  degradation: Degradation | null;
}

function buildSpec(
  card: ShadowPickCard,
): MapReduceSpec<ShadowPickCardUnit, ShadowPickClaim, ShadowPickResult, ShadowPickFacts> {
  const facts: ShadowPickFacts = {
    eventId: card.eventId,
    fightsById: new Map(card.fights.map((f) => [f.fightId, f])),
  };

  return {
    surface: "shadowPicks",
    // Exactly one unit -- the whole card. This is what turns N8's "one
    // reduce call per card" requirement into a single map-step call: the
    // harness always calls the model once per unit, so treating the card
    // itself as the unit gives one call, not one per fight.
    units: [{ eventId: card.eventId }],
    facts,
    buildMapPrompt: () => buildShadowPicksPrompt(card.fights),
    parseMapResponse: (text) => parseShadowPicksResponse(JSON.parse(text)),
    verifyMapClaims: (claims, _unit, f) => verifyClaims(claims, f, shadowPickClaimChecks),
    // No evidence, no shadow pick this run -- N8's own "Write no shadow
    // pick. Never substitute a heuristic row" rule (plan's Exhaustion
    // behaviour table): a substituted row would silently corrupt the one
    // thing this surface exists to measure.
    mapFallback: () => [],
    // The model never emits a probability itself -- applyShadowPickClaims.ts
    // is a PURE deterministic function applying the verified deltas
    // through the existing clamp, not a second LLM call. Same
    // reduceViaLlm: false posture N7's own dossiers use, for the same
    // reason: nothing here is a judgment call code can't already make.
    reduceViaLlm: false,
    reduceFallback: (mapped, f) => applyShadowPickClaims(mapped, f, "gemini"),
  };
}

/**
 * N8: one reduce call per card, only when >=1 dossier changed since the
 * last run (`fetchShadowPickCard.ts`'s `needsRun`). Writes both shadow
 * lines (`LLM_ASSISTED`, `LLM_ONLY`) per verified fight claim to
 * `shadow_picks` -- append-only, never overwritten (DECISIONS.md,
 * 2026-09-18, "N8: shadow picks revise until card lock"). Gemini's own
 * half of O3 (Track B)'s two providers -- see generateShadowPicksGroq.ts
 * for the per-fight Groq counterpart.
 */
export async function generateShadowPicks(
  supabase: SupabaseClient,
  deps: MapReduceDeps,
): Promise<GenerateShadowPicksSummary> {
  const card = await fetchShadowPickCard(supabase, "gemini");
  if (card === null) {
    return { eligibleFights: 0, ran: false, shadowPicksWritten: 0, degradation: null };
  }
  if (!card.needsRun) {
    return { eligibleFights: card.fights.length, ran: false, shadowPicksWritten: 0, degradation: null };
  }

  const outcome = await runMapReduce(buildSpec(card), deps);

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
