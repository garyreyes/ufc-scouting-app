import { requireEnv } from "../requireEnv";
import { OPENROUTER_MODEL_ID } from "./models";
import type { ModelRequest, ModelResponse } from "./types";
import { LlmQuotaError } from "./errors";

const BASE_URL = "https://openrouter.ai/api/v1";

export { LlmQuotaError };

/**
 * OpenRouter's wrapper for the multi-free-LLM task-mapping plan --
 * CLAUDE.md's one-wrapper-per-third-party-SDK rule applies here exactly
 * as it does to geminiClient.ts/groqClient.ts.
 *
 * Unlike Groq, OpenRouter's free tier is NOT a dependable second opinion
 * (Phase 0 spike, 2026-09-19 -- PROJECT_FACTS.md): free models draw from a
 * pool shared across ALL of OpenRouter's free-tier users, not a per-key
 * quota, and one candidate model failed 5/5 with a 429 from that shared
 * pool. Every caller of this wrapper MUST treat failures as expected and
 * degrade (skip this opinion / fall back to a heuristic), never as a bug
 * to retry aggressively or a dependency to block on.
 *
 * OpenAI-compatible endpoint, same response shape as Groq
 * (choices[0].message.content), so this shares its parsing logic with
 * groqClient.ts almost verbatim -- kept as a separate file anyway per the
 * one-wrapper-per-provider rule, since the base URL/API key/attribution
 * headers are genuinely provider-specific.
 */
export async function callModel(req: ModelRequest): Promise<ModelResponse> {
  const apiKey = requireEnv(process.env.OPENROUTER_API_KEY, "OPENROUTER_API_KEY");

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      // OpenRouter's own attribution convention (openrouter.ai/docs) --
      // harmless if unused by a given upstream model.
      "HTTP-Referer": "https://ufc-scouting-app-2jtj.vercel.app/",
      "X-Title": "ufc-scouting-app",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL_ID,
      messages: [{ role: "user", content: req.prompt }],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });

  if (res.status === 429) {
    throw new LlmQuotaError(`OpenRouter quota exhausted: 429 ${await res.text()}`);
  }

  if (!res.ok) {
    // Degrade-loudly, matching geminiClient.ts/groqClient.ts: never
    // swallow a failure into something that looks like a clean empty
    // result. Callers of THIS wrapper specifically are expected to treat
    // any thrown error as routine (see class doc comment) and fall back,
    // not to assume a thrown error here means something is broken.
    throw new Error(`OpenRouter request failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();

  // A single HTTP 200 can still carry a provider-level error in the body
  // (Phase 0 spike measured this live: Nvidia's upstream 503 arrived
  // wrapped inside a 200 response) -- OpenRouter's own error passthrough
  // shape, distinct from a transport-level non-2xx.
  if (json.error) {
    throw new Error(`OpenRouter upstream error: ${JSON.stringify(json.error)}`);
  }

  const text = json.choices?.[0]?.message?.content;
  if (typeof text !== "string") {
    throw new Error(`OpenRouter response missing expected message content: ${JSON.stringify(json)}`);
  }

  return {
    text,
    modelVersion: typeof json.model === "string" ? json.model : null,
    promptTokens: json.usage?.prompt_tokens ?? null,
    outputTokens: json.usage?.completion_tokens ?? null,
  };
}
