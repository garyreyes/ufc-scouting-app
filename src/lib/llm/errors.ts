/**
 * Thrown specifically on a 429 by any provider wrapper (geminiClient.ts,
 * groqClient.ts, openRouterClient.ts), so callers (the budget allocator, a
 * fallback decision) can tell "out of quota" apart from "broken" --
 * ordinary `Error`s from a wrapper mean something is actually wrong
 * (malformed response, dead model, network failure); an `LlmQuotaError`
 * means the request was well-formed and simply didn't fit this minute's
 * or today's allowance.
 *
 * Lives here, not inside any one wrapper, so a second/third provider
 * wrapper never has to import from another provider's file to share this
 * type -- each wrapper stays the single, isolated place that knows its
 * own provider's base URL/API key/model id (CLAUDE.md's one-wrapper rule).
 */
export class LlmQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmQuotaError";
  }
}
