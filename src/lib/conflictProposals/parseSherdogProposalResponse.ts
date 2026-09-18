import type { SherdogProposalClaim } from "./types";

interface RawResponse {
  chosenSherdogId?: unknown;
  rationale?: unknown;
}

/**
 * Parses one conflict's response (buildSherdogProposalPrompt.ts is a
 * per-conflict prompt, so this is a single object, not an array --
 * unlike parseClusterResponse.ts / parseRetractionResponse.ts, which
 * each parse a batch). sherdogProposalChecks.ts (via runMapReduce's
 * verifyMapClaims step) is what actually enforces every real-world fact
 * this claims -- this only shapes the JSON.
 *
 * Throws on a malformed top-level shape -- the caller
 * (proposeSherdogMatches.ts, via runMapReduce) treats that as a map
 * failure and falls back to proposing nothing for this conflict, never
 * silently reports "no match" as if the model actually reviewed it.
 */
export function parseSherdogProposalResponse(raw: unknown, conflictId: string): SherdogProposalClaim[] {
  const response = raw as RawResponse;
  if (!response || typeof response !== "object" || !("rationale" in response)) {
    throw new Error(`Sherdog proposal response missing expected fields: ${JSON.stringify(raw)}`);
  }
  if (typeof response.rationale !== "string") {
    throw new Error(`Sherdog proposal response has a non-string rationale: ${JSON.stringify(raw)}`);
  }

  const chosenSherdogId =
    typeof response.chosenSherdogId === "number" && Number.isInteger(response.chosenSherdogId)
      ? response.chosenSherdogId
      : null;

  return [{ conflictId, chosenSherdogId, rationale: response.rationale.trim() }];
}
