import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callModel, LlmQuotaError } from "./geminiClient";
import { MODEL_ID } from "./models";

function mockResponse(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })),
  );
}

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("callModel", () => {
  it("returns the text, model version, and token counts on success", async () => {
    mockResponse(200, {
      candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
      modelVersion: "gemini-3.5-flash-lite",
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3 },
    });

    const result = await callModel({ prompt: "hi" });

    expect(result.text).toBe('{"ok":true}');
    expect(result.modelVersion).toBe("gemini-3.5-flash-lite");
    expect(result.promptTokens).toBe(12);
    expect(result.outputTokens).toBe(3);
  });

  // The whole point of N1's spike: this must be set on every call, and
  // this test is what stops a future edit silently dropping it back to
  // Gemini's default temperature of 1.0 (every call before Phase N).
  it("requests temperature: 0, topK: 1, and the JSON response mime type", async () => {
    mockResponse(200, {
      candidates: [{ content: { parts: [{ text: "{}" }] } }],
    });

    await callModel({ prompt: "hi" });

    const fetchMock = vi.mocked(fetch);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(`/models/${MODEL_ID}:generateContent`);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.generationConfig).toEqual({
      responseMimeType: "application/json",
      temperature: 0,
      topK: 1,
    });
  });

  it("throws LlmQuotaError, not a plain Error, on a 429", async () => {
    mockResponse(429, { error: { message: "quota exhausted" } });

    await expect(callModel({ prompt: "hi" })).rejects.toBeInstanceOf(LlmQuotaError);
  });

  it("throws a plain Error (not LlmQuotaError) on a 503", async () => {
    mockResponse(503, { error: { message: "high demand" } });

    const promise = callModel({ prompt: "hi" });
    await expect(promise).rejects.toThrow(/503/);
    await expect(promise.catch((e) => e)).resolves.not.toBeInstanceOf(LlmQuotaError);
  });

  it("throws on a 404 (a discontinued model, e.g. gemini-2.5-flash-lite/-flash both hit this live in N1)", async () => {
    mockResponse(404, { error: { message: "no longer available to new users" } });

    await expect(callModel({ prompt: "hi" })).rejects.toThrow(/404/);
  });

  it("throws, does not return an empty result, when the response has no text content", async () => {
    mockResponse(200, { candidates: [{ content: { parts: [] } }] });

    await expect(callModel({ prompt: "hi" })).rejects.toThrow(/missing expected text content/);
  });

  it("throws when GEMINI_API_KEY is missing rather than calling with an empty key", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("GEMINI_API_KEY", "");

    await expect(callModel({ prompt: "hi" })).rejects.toThrow(/GEMINI_API_KEY/);
  });
});
