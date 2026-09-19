import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callModel, LlmQuotaError } from "./groqClient";
import { GROQ_MODEL_ID } from "./models";

function mockResponse(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })),
  );
}

beforeEach(() => {
  vi.stubEnv("GROQ_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("callModel", () => {
  it("returns the text, model version, and token counts on success", async () => {
    mockResponse(200, {
      model: GROQ_MODEL_ID,
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 21, completion_tokens: 8 },
    });

    const result = await callModel({ prompt: "hi" });

    expect(result.text).toBe('{"ok":true}');
    expect(result.modelVersion).toBe(GROQ_MODEL_ID);
    expect(result.promptTokens).toBe(21);
    expect(result.outputTokens).toBe(8);
  });

  it("requests temperature: 0, the configured model id, and json_object response format", async () => {
    mockResponse(200, { choices: [{ message: { content: "{}" } }] });

    await callModel({ prompt: "hi" });

    const fetchMock = vi.mocked(fetch);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.groq.com/openai/v1/chat/completions");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe(GROQ_MODEL_ID);
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("throws LlmQuotaError, not a plain Error, on a 429", async () => {
    mockResponse(429, { error: { message: "rate limit exceeded" } });

    await expect(callModel({ prompt: "hi" })).rejects.toBeInstanceOf(LlmQuotaError);
  });

  it("throws a plain Error (not LlmQuotaError) on a 404 (a retired/renamed model id)", async () => {
    mockResponse(404, { error: { message: "model_not_found" } });

    const promise = callModel({ prompt: "hi" });
    await expect(promise).rejects.toThrow(/404/);
    await expect(promise.catch((e) => e)).resolves.not.toBeInstanceOf(LlmQuotaError);
  });

  it("throws, does not return an empty result, when the response has no message content", async () => {
    mockResponse(200, { choices: [{ message: {} }] });

    await expect(callModel({ prompt: "hi" })).rejects.toThrow(/missing expected message content/);
  });

  it("throws when GROQ_API_KEY is missing rather than calling with an empty key", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("GROQ_API_KEY", "");

    await expect(callModel({ prompt: "hi" })).rejects.toThrow(/GROQ_API_KEY/);
  });
});
