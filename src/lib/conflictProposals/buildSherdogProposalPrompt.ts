import type { ConflictToPropose } from "./types";

/**
 * One conflict per call (the map unit) -- unlike N3's card-level
 * retraction pass, this genuinely decomposes: each conflict's evidence
 * (a stored name, a reason, a ranked candidate list) is independent of
 * every other open conflict, so there is no cross-conflict context a
 * single call would gain by batching them. sherdogProposalChecks.ts is
 * what actually enforces every rule stated here.
 */
export function buildSherdogProposalPrompt(conflict: ConflictToPropose): string {
  const reasonText =
    conflict.reason === "guard_mismatch"
      ? `The auto-match system's top pick was rejected because the Sherdog page it found was titled "${conflict.guardMismatchPageName ?? "(unknown)"}" -- likely a different person than intended.`
      : conflict.reason === "ambiguous"
        ? "More than one Sherdog fighter shares a very similar name."
        : "No candidate was a confident enough name match to link automatically.";

  const candidateList = conflict.candidates
    .map(
      (c, i) =>
        `${i + 1}. sherdogId=${c.sherdogId} name="${c.name}" nameMatchConfidence=${Math.round(c.confidence * 100)}%` +
        (c.nickname ? ` nickname="${c.nickname}"` : "") +
        (c.association ? ` team="${c.association}"` : ""),
    )
    .join("\n");

  return `You are reviewing an unresolved fighter-identity match for an MMA database. A fighter stored here as "${conflict.storedName}" needs to be linked to the correct Sherdog.com fighter page, or left unmatched if none of the candidates are actually them.

Why this needs review: ${reasonText}

Candidate Sherdog pages (numbered, each with its real "sherdogId"):
${candidateList || "(no candidates)"}

Task: decide which candidate, if any, is genuinely the same person as "${conflict.storedName}". Consider name-order variants (many Sherdog pages list surname first), romanized-vs-native spelling differences, and known ring names or nicknames that could correspond to the same fighter under a different recorded name.

Rules, all strict:
1. Only choose a "sherdogId" that appears in the candidate list above, exactly as given. Never invent one.
2. If you are not genuinely confident which candidate (if any) is the same person, choose null -- a missed match is far less costly than a wrong one, which would permanently attach someone else's fight record to this fighter.
3. Write "rationale" as one plain factual sentence explaining your reasoning either way.

Return JSON exactly in this shape, nothing else:
{"chosenSherdogId": <number> | null, "rationale": "<one sentence>"}`;
}
