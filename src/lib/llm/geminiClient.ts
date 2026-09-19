import { requireEnv } from "../requireEnv";
import { MODEL_ID } from "./models";
import type { ModelRequest, ModelResponse } from "./types";
import { LlmQuotaError } from "./errors";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

// Re-exported for back-compat -- every existing caller (index.ts,
// geminiClient.test.ts) imports LlmQuotaError from this file. The class
// itself now lives in errors.ts so groqClient.ts/openRouterClient.ts can
// share it without importing from Gemini's own wrapper.
export { LlmQuotaError };

/**
 * The one wrapper CLAUDE.md's third-party-SDK rule requires -- the only
 * file in the repo that knows the base URL, the API key, or the model id.
 * Callers never see "Gemini" or a model name, matching lib/llm.ts's
 * original contract (docs/PRD.md: a dead free tier must cost replacing
 * one file, not an audit of every caller).
 *
 * Returns raw, unparsed text -- JSON parsing lives one layer up
 * (generateJson.ts, runMapReduce.ts) so this stays a pure transport
 * client whose own test only has to fake `fetch`, not a parser too.
 *
 * temperature: 0 and topK: 1 were NOT set before Phase N -- every call to
 * date (the rumour clustering path) ran at Gemini's default temperature
 * of 1.0. Added here after the N1 spike confirmed live that both coexist
 * with responseMimeType: "application/json" and return byte-identical
 * output across repeated calls with the same prompt. This is the whole
 * determinism story available for a provider with no seed parameter and
 * (also an N1 finding) no pinnable dated model id.
 */
export async function callModel(req: ModelRequest): Promise<ModelResponse> {
  const apiKey = requireEnv(process.env.GEMINI_API_KEY, "GEMINI_API_KEY");

  const res = await fetch(`${BASE_URL}/models/${MODEL_ID}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: req.prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0,
        topK: 1,
      },
    }),
  });

  if (res.status === 429) {
    throw new LlmQuotaError(`Gemini quota exhausted: 429 ${await res.text()}`);
  }

  if (!res.ok) {
    // Degrade-loudly territory (docs/PRD.md's rumour-engine edge case,
    // extended to every map-reduce surface): a 503 (N1 measured the now-
    // abandoned strong tier failing this way 4 of 6 times) or a
    // discontinued model (404 -- what gemini-2.5-flash-lite and, found
    // during N1, gemini-2.5-flash both returned) must never be swallowed
    // into something that looks like a clean empty result. Callers decide
    // whether to fall back, and can only do that if this throws instead
    // of returning nothing.
    throw new Error(`Gemini request failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error(`Gemini response missing expected text content: ${JSON.stringify(json)}`);
  }

  return {
    text,
    modelVersion: typeof json.modelVersion === "string" ? json.modelVersion : null,
    promptTokens: json.usageMetadata?.promptTokenCount ?? null,
    outputTokens: json.usageMetadata?.candidatesTokenCount ?? null,
  };
}
