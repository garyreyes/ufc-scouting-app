import { hashCanonicalJson } from "../llm/promptHash";
import type { ScoutingFighterBundle } from "./types";

/**
 * The cache key for a fighter's scouting dossier -- the WHOLE bundle,
 * canonically hashed, never a hand-picked subset of its fields. See
 * `ScoutingFighterBundle`'s own doc comment for why hashing the whole
 * object (rather than maintaining a second field list) is what makes the
 * "cache key omits a field the prompt uses" bug class structurally
 * impossible here, not just guarded against by a test.
 */
export function computeScoutingInputHash(bundle: ScoutingFighterBundle): string {
  return hashCanonicalJson(bundle);
}
