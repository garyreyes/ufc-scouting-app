import { collapseNearDuplicates } from "./collapseNearDuplicates";
import { resolveFighterMention } from "./matchFighterMention";
import { RUMOUR_CATEGORIES } from "./types";
import type { CandidatePost, ClusteredFlag, FighterCandidate, RumourCategory } from "./types";

interface RawFlag {
  fighter?: unknown;
  category?: unknown;
  summary?: unknown;
  sourceUris?: unknown;
}

interface RawResponse {
  flags?: unknown;
}

function isRumourCategory(value: unknown): value is RumourCategory {
  return typeof value === "string" && (RUMOUR_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Validates and sanitizes lib/llm.ts's `generateJson` output for the
 * clustering prompt (buildClusterPrompt.ts). This is the actual
 * correctness-critical core of the LLM path -- PRD's "ambiguous mentions
 * are dropped, not guessed" and "a false flag is worse than a missing
 * one" apply just as much to a model's output as to a heuristic's, so
 * nothing here is ever trusted at face value:
 *
 * - `fighter` must resolve confidently to one of the two real fighters
 *   (resolveFighterMention) -- a hallucinated or ambiguous name drops the
 *   whole flag.
 * - `category` must be one of the five real categories -- anything else
 *   drops the flag rather than being guess-mapped to the nearest one.
 * - `sourceUris` is filtered down to URIs that actually exist in
 *   `knownPosts` -- a hallucinated URI is discarded, never trusted as
 *   real evidence. If nothing real is left, the flag is dropped: a flag
 *   with zero real sources is worse than no flag at all.
 * - The corroboration count is never read from the model's own words --
 *   it is `sources.length` after collapseNearDuplicates runs on the
 *   *real, resolved* posts, the same defensive pass the heuristic path
 *   uses.
 *
 * Throws (rather than silently returning []) when the top-level shape
 * isn't even `{ flags: [...] }` -- a malformed response is a sign
 * something is actually broken, and scanFightForRumours.ts must treat
 * that the same as a request failure and fall back to heuristic
 * clustering, not silently report zero flags.
 */
export function parseClusterResponse(
  raw: unknown,
  knownPosts: CandidatePost[],
  fighter1: FighterCandidate,
  fighter2: FighterCandidate,
): ClusteredFlag[] {
  const response = raw as RawResponse;
  if (!response || !Array.isArray(response.flags)) {
    throw new Error(`Cluster response missing a "flags" array: ${JSON.stringify(raw)}`);
  }

  const postsByUri = new Map(knownPosts.map((p) => [p.uri, p]));
  const flags: ClusteredFlag[] = [];

  for (const rawFlag of response.flags as RawFlag[]) {
    if (typeof rawFlag !== "object" || rawFlag === null) continue;

    const fighter =
      typeof rawFlag.fighter === "string"
        ? resolveFighterMention(rawFlag.fighter, fighter1, fighter2)
        : null;
    if (!fighter) continue;

    if (!isRumourCategory(rawFlag.category)) continue;

    if (typeof rawFlag.summary !== "string" || rawFlag.summary.trim().length === 0) continue;

    if (!Array.isArray(rawFlag.sourceUris)) continue;
    const realPosts = rawFlag.sourceUris
      .filter((uri): uri is string => typeof uri === "string")
      .map((uri) => postsByUri.get(uri))
      .filter((post): post is CandidatePost => post !== undefined);
    if (realPosts.length === 0) continue;

    const sources = collapseNearDuplicates(realPosts);

    flags.push({
      fighterId: fighter.id,
      category: rawFlag.category,
      summary: rawFlag.summary.trim(),
      sources,
    });
  }

  return flags;
}
