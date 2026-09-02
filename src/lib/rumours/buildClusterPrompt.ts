import type { CandidatePost, FighterCandidate } from "./types";

/**
 * Builds the prompt for lib/llm.ts's generateJson. Judgment/presentation
 * work (prompt wording), not correctness-critical itself -- the output it
 * produces IS validated, strictly, by parseClusterResponse.ts, which is
 * what actually enforces every rule stated here. Verified live rather
 * than unit-tested, same as the rest of this file's neighbours.
 */
export function buildClusterPrompt(
  fighter1: FighterCandidate,
  fighter2: FighterCandidate,
  posts: CandidatePost[],
): string {
  const postList = posts
    .map((p, i) => `${i + 1}. uri="${p.uri}" author="${p.authorHandle}"\n   "${p.text.replace(/"/g, "'")}"`)
    .join("\n");

  return `You are clustering real social media posts into distinct, corroborated fight-week concerns for an MMA scouting tool. You do not give opinions or credibility verdicts -- you only cluster and dedupe.

The two fighters in this bout, EXACTLY as they must appear in your output:
- "${fighter1.name}"
- "${fighter2.name}"

Candidate posts (numbered, each with its real "uri"):
${postList || "(no posts found)"}

Task: group these posts into distinct concerns. A concern is one of:
- weight_cut -- trouble making weight, a hard/late cut, hydration issues
- injury -- an injury, medical withdrawal, surgery
- camp_change -- changed gym, coach, or training camp
- short_notice_replacement -- a late replacement opponent or a fighter pulled from the card
- other -- a real, specific concern that doesn't fit the four above (do not use this for generic hype, predictions, or trash talk)

Rules, all strict:
1. Only use the two fighter names given above, exactly as written. If a post is about someone else, ignore it.
2. If a post could plausibly be about either fighter and you cannot tell which, do not include it in any flag.
3. Only cite a post's exact "uri" string from the list above in "sourceUris". Never invent a uri.
4. Multiple posts making the SAME claim in different words are still separate, independent sources -- list all of their uris. Only collapse posts that are literally the same text reposted.
5. Do not output a flag with fewer than 1 real source.
6. Write "summary" as one plain factual sentence -- never a credibility judgment, never "this is likely true/false."
7. Only flag something that could affect THIS upcoming bout -- a live risk to whether or how this fight happens. A post recapping the RESULT of a fighter's past fight (a win, a finish, an opponent's own injury in a different bout) is not a concern about this bout and must not become a flag, even if it happens to mention weight, injury, or a replacement in the past tense about a different fight.

Return JSON exactly in this shape, nothing else:
{"flags": [{"fighter": "<exact name from above>", "category": "<one of the five categories>", "summary": "<one sentence>", "sourceUris": ["<uri>", "..."]}]}

If there is nothing worth flagging, return {"flags": []}.`;
}
