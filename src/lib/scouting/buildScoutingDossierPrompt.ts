import type { ScoutingFighterBundle, ScoutingRecentBout } from "./types";

function formatBout(b: ScoutingRecentBout): string {
  const event = b.eventName ? ` at ${b.eventName}` : "";
  const when = b.eventDate ? ` (${b.eventDate})` : "";
  const method = b.method ? `, ${b.method}` : "";
  return `- id=${b.id} ${b.result.toUpperCase()} vs ${b.opponentName}${event}${when}${method}`;
}

/**
 * One fighter per call (the map unit) -- genuinely decomposes, same
 * reasoning as `buildSherdogProposalPrompt.ts`'s own header: each
 * fighter's evidence bundle is independent of every other fighter's, so
 * there is no cross-fighter context a single call would gain by
 * batching them.
 *
 * Reads every field of `ScoutingFighterBundle` and nothing else --
 * that's the half of the cache-key guarantee this file owns; see
 * `computeScoutingInputHash.ts` for the other half.
 * `scoutingDossierChecks.ts` is what actually enforces every rule stated
 * here.
 */
export function buildScoutingDossierPrompt(bundle: ScoutingFighterBundle): string {
  const boutsText =
    bundle.recentBouts.length > 0
      ? bundle.recentBouts.map(formatBout).join("\n")
      : "(no Sherdog bout history on file)";

  const flagsText =
    bundle.openFlags.length > 0
      ? bundle.openFlags.map((f) => `- id=${f.id} category=${f.category}: ${f.summary}`).join("\n")
      : "(no open rumour flags)";

  return `You are scouting an MMA fighter ahead of an upcoming bout. Everything below is real, on-record data -- do not invent facts not stated here.

Fighter: ${bundle.name} (id=${bundle.fighterId})
Elo rating: ${Math.round(bundle.eloRating)} (${bundle.ratedFightCount} rated UFC fight${bundle.ratedFightCount === 1 ? "" : "s"})
Reach: ${bundle.reachCm !== null ? `${bundle.reachCm}cm` : "unknown"}
Height: ${bundle.heightCm !== null ? `${bundle.heightCm}cm` : "unknown"}
Birth date: ${bundle.birthDate ?? "unknown"}
Sherdog record by method -- wins: ${bundle.sherdogWinsByKo ?? "?"} KO/TKO, ${bundle.sherdogWinsBySub ?? "?"} SUB, ${bundle.sherdogWinsByDec ?? "?"} DEC; losses: ${bundle.sherdogLossesByKo ?? "?"} KO/TKO, ${bundle.sherdogLossesBySub ?? "?"} SUB, ${bundle.sherdogLossesByDec ?? "?"} DEC

Most recent bouts (most recent first):
${boutsText}

Open rumour flags concerning this fighter's upcoming bout:
${flagsText}

Task: write a scouting read in four parts, each one or two plain factual sentences grounded ONLY in the data above:
- formTrajectory: trending up or down, based on recent results
- stylisticProfile: how they tend to win or lose, from the method data
- durability: finish resistance or vulnerability, from the record and recent bouts
- layoff: time since their last bout and what it might mean

Rules, all strict:
1. citedBoutIds must list only "id" values that appear in the bout list above, exactly as given -- never invent one, never cite a bout not shown.
2. citedFlagIds must list only "id" values that appear in the flag list above -- omit entirely (empty array) if you did not rely on a flag.
3. Never state a specific number (Elo, reach, height, a record count) other than one already given above, exactly as given.

Return JSON exactly in this shape, nothing else:
{"formTrajectory": "<1-2 sentences>", "stylisticProfile": "<1-2 sentences>", "durability": "<1-2 sentences>", "layoff": "<1-2 sentences>", "citedBoutIds": ["<id>", ...], "citedFlagIds": ["<id>", ...]}`;
}
