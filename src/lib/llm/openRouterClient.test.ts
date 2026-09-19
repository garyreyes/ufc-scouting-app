import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callModel, LlmQuotaError } from "./openRouterClient";
import { OPENROUTER_MODEL_ID } from "./models";

function mockResponse(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })),
  );
}

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("callModel", () => {
  it("returns the text, model version, and token counts on success", async () => {
    mockResponse(200, {
      model: OPENROUTER_MODEL_ID,
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 21, completion_tokens: 8 },
    });

    const result = await callModel({ prompt: "hi" });

    expect(result.text).toBe('{"ok":true}');
    expect(result.modelVersion).toBe(OPENROUTER_MODEL_ID);
    expect(result.promptTokens).toBe(21);
    expect(result.outputTokens).toBe(8);
  });

  it("requests temperature: 0, the configured model id, and json_object response format", async () => {
    mockResponse(200, { choices: [{ message: { content: "{}" } }] });

    await callModel({ prompt: "hi" });

    const fetchMock = vi.mocked(fetch);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe(OPENROUTER_MODEL_ID);
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("throws LlmQuotaError, not a plain Error, on a 429", async () => {
    mockResponse(429, { error: { message: "rate limit exceeded" } });

    await expect(callModel({ prompt: "hi" })).rejects.toBeInstanceOf(LlmQuotaError);
  });

  it("throws a plain Error (not LlmQuotaError) on a 404 (an unavailable free-tier slug)", async () => {
    mockResponse(404, { error: { message: "This model is unavailable for free" } });

    const promise = callModel({ prompt: "hi" });
    await expect(promise).rejects.toThrow(/404/);
    await expect(promise.catch((e) => e)).resolves.not.toBeInstanceOf(LlmQuotaError);
  });

  // Measured live in the Phase 0 spike (2026-09-19): Nvidia's own upstream
  // 503 arrived wrapped inside an HTTP 200 response body, not as a
  // transport-level error -- this is the case that would slip through if
  // only res.ok were checked.
  it("throws on a 200 response whose body carries an upstream provider error", async () => {
    mockResponse(200, {
      id: "gen-123",
      error: { message: "Upstream error from Nvidia: Service temporarily overloaded", code: 503 },
    });

    await expect(callModel({ prompt: "hi" })).rejects.toThrow(/upstream error/i);
  });

  it("throws, does not return an empty result, when the response has no message content", async () => {
    mockResponse(200, { choices: [{ message: {} }] });

    await expect(callModel({ prompt: "hi" })).rejects.toThrow(/missing expected message content/);
  });

  it("throws when OPENROUTER_API_KEY is missing rather than calling with an empty key", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("OPENROUTER_API_KEY", "");

    await expect(callModel({ prompt: "hi" })).rejects.toThrow(/OPENROUTER_API_KEY/);
  });
});
