import type { SupabaseClient } from "@supabase/supabase-js";
import { searchMmaPosts } from "../bluesky";
import { generateJson } from "../llm";
import { buildClusterPrompt } from "./buildClusterPrompt";
import { heuristicCluster } from "./heuristicCluster";
import { isNamedSource } from "./isNamedSource";
import { parseClusterResponse } from "./parseClusterResponse";
import type { CandidatePost, ClusteredFlag, FighterCandidate } from "./types";

export interface FightToScan {
  id: string;
  fighter1: FighterCandidate;
  fighter2: FighterCandidate;
}

export interface ScanFightResult {
  fightId: string;
  mode: "llm" | "heuristic" | "skipped_no_posts";
  flagsWritten: number;
  sourcesWritten: number;
}

async function collectCandidatePosts(
  fighter1: FighterCandidate,
  fighter2: FighterCandidate,
): Promise<CandidatePost[]> {
  const [posts1, posts2] = await Promise.all([
    searchMmaPosts(fighter1.name),
    searchMmaPosts(fighter2.name),
  ]);
  // De-duped by uri -- a post naming both fighters would otherwise appear
  // twice in the combined list from the two separate searches.
  const byUri = new Map<string, CandidatePost>();
  for (const post of [...posts1, ...posts2]) byUri.set(post.uri, post);
  return [...byUri.values()];
}

/**
 * One fight's worth of the F2 pipeline: search Bluesky for both fighters,
 * cluster the results (LLM first, heuristic fallback on ANY failure --
 * network, rate limit, or a malformed response parseClusterResponse.ts
 * rejects), then upsert the result.
 *
 * Every run re-searches and re-clusters the same recent posts rather than
 * filtering out ones already captured -- deliberately, found live
 * (2026-09-02, 0025_rumour_sources_unique_per_flag.sql): a single real
 * post commonly supports more than one distinct flag (a short-notice
 * announcement post that also mentions the fighter's weight-cut history,
 * say), so "have I seen this post anywhere before" is the wrong question
 * -- the real idempotency guarantee is rumour_sources' unique(flag_id,
 * post_uri), which only rejects re-adding the SAME post to the SAME flag.
 * Re-clustering already-seen posts costs a little LLM budget every run,
 * comfortably affordable given lib/llm.ts's 500 RPD ceiling against this
 * job's real per-run call count.
 *
 * Flags merge into an existing (fight, fighter, category) row rather than
 * duplicating -- 0024_rumour_flags_and_sources.sql's unique constraint is
 * the upsert target -- so corroboration accumulates across runs instead
 * of resetting.
 */
export async function scanFightForRumours(
  supabase: SupabaseClient,
  fight: FightToScan,
): Promise<ScanFightResult> {
  const candidatePosts = await collectCandidatePosts(fight.fighter1, fight.fighter2);

  if (candidatePosts.length === 0) {
    return { fightId: fight.id, mode: "skipped_no_posts", flagsWritten: 0, sourcesWritten: 0 };
  }

  let flags: ClusteredFlag[];
  let mode: "llm" | "heuristic";
  try {
    const prompt = buildClusterPrompt(fight.fighter1, fight.fighter2, candidatePosts);
    const raw = await generateJson<unknown>(prompt);
    flags = parseClusterResponse(raw, candidatePosts, fight.fighter1, fight.fighter2);
    mode = "llm";
  } catch {
    // Degrade loudly, never silently: the caller's job_runs summary
    // records how many fights fell back so a run that quietly went
    // all-heuristic is still visible, not indistinguishable from a
    // healthy LLM run that just found nothing.
    flags = heuristicCluster(candidatePosts, fight.fighter1, fight.fighter2);
    mode = "heuristic";
  }

  let flagsWritten = 0;
  let sourcesWritten = 0;

  for (const flag of flags) {
    const { data: flagRow, error: flagError } = await supabase
      .from("rumour_flags")
      .upsert(
        {
          fight_id: fight.id,
          fighter_id: flag.fighterId,
          category: flag.category,
          summary: flag.summary,
          last_corroborated_at: new Date().toISOString(),
        },
        { onConflict: "fight_id,fighter_id,category" },
      )
      .select("id")
      .single();
    if (flagError) throw flagError;
    flagsWritten++;

    for (const source of flag.sources) {
      const { error: sourceError } = await supabase.from("rumour_sources").insert({
        flag_id: flagRow.id,
        post_uri: source.uri,
        author_handle: source.authorHandle,
        excerpt: source.text,
        external_url: source.externalUrl,
        is_named_source: isNamedSource(source.authorHandle),
        post_created_at: source.createdAt,
      });
      // unique(flag_id, post_uri) rejecting a post this flag already has
      // (a re-run seeing the same post again, or a concurrent run) --
      // not a reason to abort the rest of this flag's sources.
      if (!sourceError) sourcesWritten++;
    }
  }

  return { fightId: fight.id, mode, flagsWritten, sourcesWritten };
}
