import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logLlmCall } from "./logLlmCall";
import { hashCanonicalJson } from "../promptHash";

function fakeSupabase(errorOnUpdate: unknown = null) {
  const eq = vi.fn(async () => ({ error: errorOnUpdate }));
  const update = vi.fn(() => ({ eq }));
  const client = { from: () => ({ update }) } as unknown as SupabaseClient;
  return { client, update, eq };
}

describe("logLlmCall", () => {
  it("writes status, prompt hash/length, raw output, and targets the reserved row by id", async () => {
    const { client, update, eq } = fakeSupabase();

    await logLlmCall(client, {
      callLogId: "row-1",
      status: "ok",
      prompt: "hello world",
      rawOutput: '{"ok":true}',
      error: null,
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ok",
        prompt_hash: hashCanonicalJson("hello world"),
        prompt_chars: "hello world".length,
        raw_output: '{"ok":true}',
        error: null,
      }),
    );
    expect(eq).toHaveBeenCalledWith("id", "row-1");
  });

  it("logs to console but does not throw when the update itself fails", async () => {
    const { client } = fakeSupabase(new Error("row locked"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      logLlmCall(client, { callLogId: "row-1", status: "error", prompt: "p", rawOutput: null, error: "boom" }),
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
