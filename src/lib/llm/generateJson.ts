import { callModel } from "./geminiClient";

/**
 * The pre-Phase-N surface, kept byte-for-byte: `callModel` + `JSON.parse`,
 * same error messages, same behaviour. scanFightForRumours.ts imports this
 * unchanged -- Phase N adds a harness alongside the existing caller, it
 * does not require touching it. (uses `responseMimeType: "application/json"`
 * under the hood, same as before Phase N; the only behavioural change is
 * geminiClient.ts now also sets temperature: 0 and topK: 1, which N1
 * confirmed still returns clean, directly parseable text every time.)
 */
export async function generateJson<T>(prompt: string): Promise<T> {
  const { text } = await callModel({ prompt });
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new Error(
      `Gemini returned text that isn't valid JSON despite responseMimeType: ${err instanceof Error ? err.message : err}. Raw text: ${text}`,
    );
  }
}
