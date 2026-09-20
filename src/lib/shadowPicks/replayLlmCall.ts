import { verifyClaims } from "../llm/verifyClaims";
import type { MappedUnit } from "../llm/runMapReduce";
import { applyShadowPickClaims } from "./applyShadowPickClaims";
import { parseShadowPicksResponse } from "./parseShadowPicksResponse";
import { shadowPickClaimChecks } from "./shadowPickClaimChecks";
import type { ShadowPickCardUnit, ShadowPickClaim, ShadowPickFacts, ShadowPickResult } from "./types";

export interface ReplayLlmCallResult {
  results: ShadowPickResult[];
  claimsProposed: number;
  claimsKept: number;
  dropReasons: Record<string, number>;
}

/**
 * N9's replay capability (0047_llm_call_log.sql's own header comment:
 * "re-run the entire post-model pipeline over a stored real payload
 * without spending a new call"). Runs the EXACT parse -> verify -> apply
 * pipeline `generateShadowPicks.ts` runs on a live response --
 * `parseShadowPicksResponse`, `shadowPickClaimChecks` (via
 * `verifyClaims`), `applyShadowPickClaims` -- so a parser or verifier
 * regression shows up here as a real diff, never invisible because
 * replay quietly drifted into its own hand-copied reimplementation
 * (`RETROSPECTIVE.md`'s entry #9 names exactly this failure shape for a
 * different rule).
 *
 * `facts` must be rebuilt from CURRENT data (`buildFightFacts.ts`), which
 * may legitimately differ from what the original call actually saw --
 * `runLlmReplay.ts`'s own prompt-hash comparison is what tells a caller
 * whether that happened, this function does not.
 *
 * O3 (Track B): deliberately stays Gemini-scoped for this pass -- a
 * `--provider` flag on `runLlmReplay.ts` is a clean, small later add,
 * not part of this phase (see the plan's own deferred-scope note).
 */
export function replayLlmCall(
  rawOutput: string,
  eventId: string,
  callLogId: string,
  facts: ShadowPickFacts,
): ReplayLlmCallResult {
  const claims = parseShadowPicksResponse(JSON.parse(rawOutput));
  const verified = verifyClaims(claims, facts, shadowPickClaimChecks);

  const mapped: MappedUnit<ShadowPickCardUnit, ShadowPickClaim>[] = [
    { unit: { eventId }, claims: verified.kept, source: "llm", callLogId },
  ];
  const results = applyShadowPickClaims(mapped, facts, "gemini");

  return {
    results,
    claimsProposed: claims.length,
    claimsKept: verified.kept.length,
    dropReasons: verified.dropReasons,
  };
}

interface LooseRawPick {
  fightId?: unknown;
}

/**
 * A deliberately lenient companion to `parseShadowPicksResponse.ts`: that
 * parser throws on the first malformed pick, which is exactly the wrong
 * behavior when the whole reason to replay a call is that something
 * about it was malformed. `runLlmReplay.ts` uses this first, before ever
 * calling the strict parser, to find which fights to rebuild facts for
 * (N9 audit finding #3: the one call most worth replaying -- a
 * dropped-every-claim run -- wrote zero `shadow_picks` rows, so its
 * fights can't be recovered from that table at all).
 */
export function extractFightIdsFromRawOutput(rawOutput: string): string[] {
  try {
    const parsed = JSON.parse(rawOutput) as { picks?: unknown };
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.picks)) return [];

    const ids = new Set<string>();
    for (const pick of parsed.picks as LooseRawPick[]) {
      if (typeof pick?.fightId === "string" && pick.fightId.trim().length > 0) {
        ids.add(pick.fightId.trim());
      }
    }
    return [...ids];
  } catch {
    return [];
  }
}
