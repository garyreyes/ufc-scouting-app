import { collapseNearDuplicates } from "./collapseNearDuplicates";
import { CATEGORY_LABELS, CONCERN_KEYWORDS } from "./concernKeywords";
import { findFighterMentionInText } from "./matchFighterMention";
import type { CandidatePost, ClusteredFlag, FighterCandidate, RumourCategory } from "./types";

type HeuristicCategory = Exclude<RumourCategory, "other">;

function matchCategory(text: string): HeuristicCategory | null {
  const lower = text.toLowerCase();
  for (const category of Object.keys(CONCERN_KEYWORDS) as HeuristicCategory[]) {
    if (CONCERN_KEYWORDS[category].some((phrase) => lower.includes(phrase))) {
      return category;
    }
  }
  return null;
}

/**
 * The degrade-loudly fallback (ROADMAP.md F2 note): fuzzy fighter-name
 * matching (matchFighterMention.ts) plus a fixed keyword list
 * (concernKeywords.ts), used only when the LLM path
 * (parseClusterResponse.ts) is unavailable. Deliberately more
 * conservative than the LLM path -- see concernKeywords.ts's note on why
 * 'other' is unreachable here, and matchFighterMention.ts's note on why a
 * post naming both fighters is dropped rather than guessed.
 *
 * Summaries are template text, not prose -- there is no LLM here to write
 * a natural sentence, and pretending otherwise would misrepresent a
 * mechanical keyword match as read judgment. The wording says so
 * explicitly, matching the "must degrade loudly" rule down to the
 * individual flag, not just the job-health banner.
 */
export function heuristicCluster(
  posts: CandidatePost[],
  fighter1: FighterCandidate,
  fighter2: FighterCandidate,
): ClusteredFlag[] {
  const groups = new Map<string, CandidatePost[]>();

  for (const post of posts) {
    const fighter = findFighterMentionInText(post.text, fighter1, fighter2);
    if (!fighter) continue;

    const category = matchCategory(post.text);
    if (!category) continue;

    const key = `${fighter.id}::${category}`;
    const group = groups.get(key) ?? [];
    group.push(post);
    groups.set(key, group);
  }

  const flags: ClusteredFlag[] = [];
  for (const [key, groupPosts] of groups) {
    const [fighterId, category] = key.split("::") as [string, HeuristicCategory];
    const fighter = fighterId === fighter1.id ? fighter1 : fighter2;
    const sources = collapseNearDuplicates(groupPosts);

    flags.push({
      fighterId: fighter.id,
      category,
      // Deliberately no post count here: this summary can be written on a
      // later run that merges into an already-existing flag (this file's
      // caller upserts by fight+fighter+category), and `sources` here is
      // only this run's own batch, not the flag's true cumulative total --
      // stating a number here would drift from the real one, which is
      // always count(*) on rumour_sources at read time (see the
      // migration's note). This text is purely descriptive.
      summary: `Mentions of ${CATEGORY_LABELS[category]} concerns for ${fighter.name} (keyword match, not AI-reviewed).`,
      sources,
    });
  }

  return flags;
}
