import type { RetractionClaim } from "./types";

interface RawDecision {
  flagId?: unknown;
  action?: unknown;
  supersededByUri?: unknown;
  rationale?: unknown;
}

interface RawResponse {
  decisions?: unknown;
}

/**
 * Parses lib/llm.ts's `generateJson` output for buildRetractionPrompt.ts
 * into loosely-typed RetractionClaim entries. Deliberately lenient at the
 * per-item level -- a malformed individual decision is skipped, not fatal
 * to the whole response, same as parseClusterResponse.ts -- because
 * retractionChecks.ts (via runMapReduce's verifyMapClaims step) is what
 * actually enforces every real-world fact this response claims: whether
 * flagId is a real open flag, whether supersededByUri is a real post,
 * whether that post is actually newer, and whether it's actually about
 * the right fighter. This file only shapes the JSON into something those
 * checks can run against.
 *
 * Throws (rather than silently returning []) when the top-level shape
 * isn't even `{ decisions: [...] }` -- a malformed response is a sign
 * something is actually broken, and proposeCardRetractions.ts must treat
 * that the same as a request failure and propose nothing this run, not
 * silently report zero retractions as if the model reviewed every flag
 * and found nothing.
 */
export function parseRetractionResponse(raw: unknown): RetractionClaim[] {
  const response = raw as RawResponse;
  if (!response || !Array.isArray(response.decisions)) {
    throw new Error(`Retraction response missing a "decisions" array: ${JSON.stringify(raw)}`);
  }

  const claims: RetractionClaim[] = [];
  for (const rawDecision of response.decisions as RawDecision[]) {
    if (typeof rawDecision !== "object" || rawDecision === null) continue;
    if (typeof rawDecision.flagId !== "string" || rawDecision.flagId.trim().length === 0) continue;
    if (rawDecision.action !== "keep" && rawDecision.action !== "retract") continue;
    if (typeof rawDecision.rationale !== "string") continue;

    claims.push({
      flagId: rawDecision.flagId,
      action: rawDecision.action,
      supersededByUri: typeof rawDecision.supersededByUri === "string" ? rawDecision.supersededByUri : null,
      rationale: rawDecision.rationale.trim(),
    });
  }
  return claims;
}
