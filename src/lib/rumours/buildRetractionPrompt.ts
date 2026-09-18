import type { CandidatePost, OpenFlagForRetraction } from "./types";

/**
 * Builds the card-level retraction prompt: every currently-open flag on
 * this card, plus every post collected across all of this run's per-fight
 * scans, asking whether any flag is now contradicted by a strictly newer
 * post. Judgment/presentation work (prompt wording) -- retractionChecks.ts
 * is what actually enforces every rule stated here, the same split
 * buildClusterPrompt.ts / parseClusterResponse.ts already uses.
 *
 * Deliberately does NOT ask the model to attribute a fighter to its own
 * "supersededByUri" pick -- retractionChecks.ts independently determines
 * which fighter a superseding post is about, from the post's own text
 * (findFighterMentionInText), never from what the model claims. Asking
 * the model for an attribution it can't be checked against would just be
 * another unverified field to eventually distrust.
 */
export function buildRetractionPrompt(flags: OpenFlagForRetraction[], posts: CandidatePost[]): string {
  const flagList = flags
    .map(
      (f, i) =>
        `${i + 1}. flagId="${f.id}" fighter="${f.fighter1.id === f.fighterId ? f.fighter1.name : f.fighter2.name}" category=${f.category} posted_by=${f.mostRecentSourceAt}\n   "${f.summary.replace(/"/g, "'")}"`,
    )
    .join("\n");

  const postList = posts
    .map((p, i) => `${i + 1}. uri="${p.uri}" posted=${p.createdAt}\n   "${p.text.replace(/"/g, "'")}"`)
    .join("\n");

  return `You are reviewing open fight-week concerns for an MMA scouting tool to decide whether any are now out of date. You do not give opinions or credibility verdicts -- you only compare a concern against newer evidence.

Open concerns (numbered, each with its own "flagId" and the date of its most recent supporting post):
${flagList || "(none)"}

Newer candidate posts from this run (numbered, each with its real "uri" and post date):
${postList || "(none)"}

Task: for EACH open concern above, decide "keep" or "retract".

Rules, all strict:
1. Retract a concern ONLY if a post in the candidate list is dated STRICTLY AFTER that concern's own "posted_by" date AND directly contradicts or resolves that specific concern for that specific fighter (e.g. "made weight" resolves a weight_cut concern; "back with his coach" resolves a camp_change concern; "fully healthy, cleared to fight" resolves an injury concern).
2. A post that is merely newer but unrelated to the concern's category does not retract it.
3. A post about the OTHER fighter in the bout, or about a different concern entirely, does not retract this concern.
4. When genuinely unsure, keep the concern -- a missed retraction is far less costly than a wrong one.
5. If you retract a concern, cite the exact "uri" of the single post that justifies it in "supersededByUri". Never invent a uri, and never cite a post older than the concern's own "posted_by" date.
6. Write "rationale" as one plain factual sentence explaining your decision, for either action.

Return JSON exactly in this shape, one entry per concern listed above, nothing else:
{"decisions": [{"flagId": "<exact flagId from above>", "action": "keep" | "retract", "supersededByUri": "<uri>" | null, "rationale": "<one sentence>"}]}`;
}
