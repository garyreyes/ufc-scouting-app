import { requireEnv } from "../requireEnv";
import { GROQ_MODEL_ID } from "./models";
import type { ModelRequest, ModelResponse } from "./types";
import { LlmQuotaError } from "./errors";

const BASE_URL = "https://api.groq.com/openai/v1";

export { LlmQuotaError };

/**
 * Groq's second-provider wrapper for the multi-free-LLM task-mapping plan
 * -- CLAUDE.md's one-wrapper-per-third-party-SDK rule applies here exactly
 * as it does to geminiClient.ts. The only file that knows Groq's base URL,
 * API key, or model id.
 *
 * Groq's endpoint is OpenAI-compatible, so this shares the response shape
 * (choices[0].message.content) with a plain chat-completions call rather
 * than Gemini's candidates[0].content.parts[0].text -- everything past
 * this file (generateJson.ts, runMapReduce.ts) only sees the common
 * ModelResponse shape and never needs to know which provider answered.
 *
 * temperature: 0 for the same determinism reasoning as Gemini's wrapper.
 * response_format: json_object was confirmed live (Phase 0 spike,
 * 2026-09-19) to return clean, directly-parseable JSON on every call for
 * both candidate models -- no markdown fences, no wrapper text.
 */
export async function callModel(req: ModelRequest): Promise<ModelResponse> {
  const apiKey = requireEnv(process.env.GROQ_API_KEY, "GROQ_API_KEY");

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL_ID,
      messages: [{ role: "user", content: req.prompt }],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });

  if (res.status === 429) {
    throw new LlmQuotaError(`Groq quota exhausted: 429 ${await res.text()}`);
  }

  if (!res.ok) {
    // Degrade-loudly, matching geminiClient.ts: a 503 or a retired model
    // id must never be swallowed into something that looks like a clean
    // empty result. Callers decide whether to fall back.
    throw new Error(`Groq request failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  const text = json.choices?.[0]?.message?.content;
  if (typeof text !== "string") {
    throw new Error(`Groq response missing expected message content: ${JSON.stringify(json)}`);
  }

  return {
    text,
    modelVersion: typeof json.model === "string" ? json.model : null,
    promptTokens: json.usage?.prompt_tokens ?? null,
    outputTokens: json.usage?.completion_tokens ?? null,
  };
}
