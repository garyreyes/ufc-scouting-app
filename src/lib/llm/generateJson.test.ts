import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateJson } from "./generateJson";

function mockText(text: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ),
  );
}

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("generateJson", () => {
  it("parses clean JSON text into the caller's shape", async () => {
    mockText('{"flags":[{"category":"injury"}]}');

    const result = await generateJson<{ flags: { category: string }[] }>("prompt");

    expect(result.flags).toEqual([{ category: "injury" }]);
  });

  // Byte-for-byte preserved from the pre-Phase-N lib/llm.ts -- the error
  // message shape is part of the contract scanFightForRumours.ts's catch
  // block relies on (it only checks "did this throw," not the message),
  // but a message regression here would still be a real debugging loss.
  it("throws a descriptive error, including the raw text, on unparseable JSON", async () => {
    mockText("not json at all despite responseMimeType");

    // [\s\S]* instead of a dotAll (/s) flag -- the project's tsconfig
    // targets ES2017, which predates the /s flag; Next's own tsc build
    // step enforces that even though vitest's esbuild transform didn't.
    await expect(generateJson("prompt")).rejects.toThrow(
      /Gemini returned text that isn't valid JSON[\s\S]*not json at all/,
    );
  });
});
