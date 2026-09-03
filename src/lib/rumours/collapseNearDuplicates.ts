import { nameSimilarity } from "../text/nameSimilarity";
import type { CandidatePost } from "./types";

// Two posts are treated as the same claim, not two independent ones, once
// their text is this similar -- PRD's "rumour volume spike from a joke or
// meme" edge case names this exactly: "corroboration counts independent
// claims, not raw post volume; near-duplicates collapse." High on
// purpose: two posts genuinely reporting the same fact in different words
// should NOT collapse (that would be losing real corroboration), only
// near-identical text (copy-paste, quote-posts, repost-with-comment).
const NEAR_DUPLICATE_THRESHOLD = 0.9;

/**
 * Collapses near-duplicate posts within one flag's source list down to one
 * representative each. Order-preserving: keeps the first post of each
 * near-duplicate cluster.
 *
 * Shared by both clustering paths: heuristicCluster.ts uses it directly
 * (no LLM to dedupe for it), and parseClusterResponse.ts applies it as a
 * defensive second pass on the LLM's own output -- the corroboration
 * count is `sources.length` after this runs, computed by this code, never
 * trusted as a number the model reports about itself.
 */
export function collapseNearDuplicates(posts: CandidatePost[]): CandidatePost[] {
  const kept: CandidatePost[] = [];
  for (const post of posts) {
    const isDuplicate = kept.some((k) => nameSimilarity(k.text, post.text) >= NEAR_DUPLICATE_THRESHOLD);
    if (!isDuplicate) kept.push(post);
  }
  return kept;
}
