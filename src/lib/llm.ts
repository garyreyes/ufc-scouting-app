import { requireEnv } from "./requireEnv";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

// Verified live 2026-09-02 (ROADMAP.md F1), not assumed from docs or
// training data (Google's own rate-limits page explicitly refuses to
// publish a fixed number, pointing to the per-account AI Studio
// dashboard instead -- so this account's own dashboard is what was
// actually checked):
//
//   Model                                    RPM   TPM    RPD
//   gemini-2.5 / 3 / 3.5 / 3.6 / 3.7 Flash    5     250K   20
//   gemini-3.1 / 3.5 Flash Lite               15    250K   500
//
// Every full "Flash" model checked caps at 20 requests/day; the two
// newest "Flash Lite" variants get 25x that. A live side-by-side test
// (the identical clustering prompt against gemini-flash-latest and
// gemini-3.5-flash-lite) returned matching quality -- same correct
// dedup, same correct exclusion of a joke/troll post, even the same
// attribution miss on a deliberately ambiguous case (confirming that
// miss is a prompt-design gap, not a Lite-specific capability gap) --
// while Lite ran faster and spent zero tokens on internal "thinking"
// (782 thinking tokens on the full model vs. none here). Given
// docs/PRD.md's $0-hard-ceiling constraint and the request-count-bound
// free tier, the higher RPD budget is the deciding factor.
// `gemini-2.5-flash-lite` is confirmed dead -- calling it live returned
// a 404 telling new callers to use `gemini-3.5-flash-lite` instead.
const MODEL = "gemini-3.5-flash-lite";

/**
 * The one wrapper CLAUDE.md's third-party-SDK rule requires, and the one
 * file docs/PRD.md says a dead free tier costs to replace ("must sit
 * behind one swappable wrapper module"). Callers never see "Gemini" or a
 * model name -- only "give me JSON back for this prompt."
 *
 * Uses Gemini's native `responseMimeType: "application/json"` rather
 * than a prose instruction ("return only JSON") -- verified live that
 * the prose approach wraps output in ```json markdown fences (a real
 * parsing footgun on every call), while the native mode returns clean,
 * directly `JSON.parse`-able text every time it was tested.
 */
export async function generateJson<T>(prompt: string): Promise<T> {
  const apiKey = requireEnv(process.env.GEMINI_API_KEY, "GEMINI_API_KEY");

  const res = await fetch(`${BASE_URL}/models/${MODEL}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });

  if (!res.ok) {
    // Degrade-loudly territory (docs/PRD.md's rumour-engine edge case):
    // an exhausted free tier (429) or a discontinued model (404, exactly
    // what gemini-2.5-flash-lite returned above) must never be swallowed
    // into something that looks like a clean empty result -- the caller
    // (Phase F2) is what decides to fall back to heuristic clustering,
    // and it can only do that if this throws instead of returning
    // nothing.
    throw new Error(`Gemini request failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error(`Gemini response missing expected text content: ${JSON.stringify(json)}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new Error(
      `Gemini returned text that isn't valid JSON despite responseMimeType: ${err instanceof Error ? err.message : err}. Raw text: ${text}`,
    );
  }
}
