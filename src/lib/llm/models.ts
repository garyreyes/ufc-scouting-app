// Single source of truth for the model id and its measured quotas --
// what used to be a prose comment in lib/llm.ts is now data, so the N1
// spike's numbers, the budget allocator, and PROJECT_FACTS.md's own
// record all read from the same place.
//
// Re-verified live 2026-09-18 (Phase N1) after a two-tier design (a cheap
// "map" model plus a stronger "reduce" model) was tried and dropped -- see
// DECISIONS.md "N1: one model tier (Flash Lite), no strong-tier reducer".
// The strong tier (gemini-3.5-flash / -3.7-flash / -3.8-flash) failed 4 of
// 6 live calls with `503 UNAVAILABLE`, ran 10-20x slower, and showed no
// reproducible quality edge over Flash Lite on two trap-laden card-level
// consolidation tasks. Every call in this codebase now goes to one model.
export const MODEL_ID = "gemini-3.5-flash-lite";

// Dashboard-confirmed 2026-09-18 (PROJECT_FACTS.md "Undocumented external
// limits"), unchanged since the original F1 measurement (2026-09-02).
// Google publishes none of this -- ai.google.dev/gemini-api/docs/rate-limits
// explicitly defers to the per-account AI Studio dashboard instead of a
// fixed number.
//
// RPM, not RPD, is the binding constraint. The same dashboard check showed
// production peaking at 14/15 RPM (93%) against only 56/500 RPD (11%) and
// 88K/250K TPM (35%). The cause is structural -- runRumourScanJob.ts issues
// one call per fight, serially, ~1s apart -- and every map-reduce caller
// must be paced against this, not against the daily figure, which will
// essentially never bind at current load (~100 calls/day typical).
export const QUOTA = {
  modelId: MODEL_ID,
  rpm: 15,
  tpm: 250_000,
  rpd: 500,
  measuredOn: "2026-09-18",
} as const;

// 15 RPM is exactly 4000ms/call with zero slack. Pacing at 4200ms leaves a
// small margin rather than riding the limit exactly, since two jobs
// starting close together (GitHub Actions' documented scheduling drift --
// settle.yml) share this same per-model bucket and neither can see the
// other's local timer.
export const MIN_CALL_INTERVAL_MS = 4_200;

// Daily counter exists for observability and replay (llm_call_log), not
// as the real guard -- at ~100/day typical load against 500/day, this
// will rarely if ever fire. See DECISIONS.md's N1 entry.
export const DAILY_CALL_CAP = QUOTA.rpd;

// Second-provider constants for the multi-free-LLM task-mapping plan
// (cross-provider second opinions + shadow-pick ensembling -- see
// DECISIONS.md "Multi-free-LLM plan: Groq is per-item only, OpenRouter is
// best-effort only", 2026-09-19). Measured live the same way as the Gemini
// block above, not read from vendor docs -- see PROJECT_FACTS.md's
// "Groq and OpenRouter free tiers, measured live 2026-09-19" entry for the
// full spike.

// qwen3.8-27b chosen over gpt-oss-20b: same 10/10 reliability and JSON
// correctness in the spike, but ~2x faster (~350-440ms vs ~800-1000ms) and
// doesn't waste tokens on an unused `reasoning` field.
export const GROQ_MODEL_ID = "qwen/qwen3.8-27b";

export const GROQ_QUOTA = {
  modelId: GROQ_MODEL_ID,
  // Derived from the spike's own x-ratelimit-* headers, not assumed: the
  // request-reset value grows by exactly 86.4s per call (1000 ÷ 86400s/day),
  // and the token-reset value matches (tokensUsed ÷ 8000) × 60s exactly.
  rpm: null, // never hit in the spike (5 calls in <5s all succeeded) -- not the binding constraint, unlike Gemini
  tpm: 8_000,
  rpd: 1_000,
  measuredOn: "2026-09-19",
} as const;

// 8000 TPM is the real binding constraint (see GROQ_QUOTA), not request
// count -- a single-item prompt (one fighter/fight) fits comfortably, but
// this model must never receive the existing whole-card shadow-picks
// prompt as-is. No MIN_CALL_INTERVAL_MS is set: RPD, not RPM, binds here,
// and the existing per-model pacing in try_reserve_llm_call (0047) only
// needs an interval when RPM is the real constraint.

// OpenRouter free models draw from a pool shared across ALL of
// OpenRouter's free-tier users, not a per-key quota -- there is no stable
// per-model rate to pin the way GROQ_QUOTA does. Treat every call as
// best-effort: nvidia/nemotron-3-super-120b-a12b:free was the more
// reliable of the two spiked (4/5 vs. 0/5 for google/gemma-4-31b-it:free,
// which failed every attempt on the shared pool's 429).
export const OPENROUTER_MODEL_ID = "nvidia/nemotron-3-super-120b-a12b:free";
