import { createHash } from "node:crypto";

/**
 * Stable sha256 over canonical JSON -- the cache key for N7's per-fighter
 * scouting dossiers and the replay key for every stored LLM decision
 * (llm_call_log.prompt_hash). "Canonical" means object keys are sorted
 * recursively before stringifying, so `{a:1,b:2}` and `{b:2,a:1}` hash
 * identically -- without this, a cache built on `JSON.stringify` alone
 * would silently miss on key-order differences that carry no real meaning
 * (e.g. two call sites building the same fighter bundle in a different
 * field order), producing spurious cache misses that look like the
 * fighter's data changed when it did not.
 */
export function hashCanonicalJson(value: unknown): string {
  return createHash("sha256").update(canonicalStringify(value)).digest("hex");
}

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(",")}}`;
}
