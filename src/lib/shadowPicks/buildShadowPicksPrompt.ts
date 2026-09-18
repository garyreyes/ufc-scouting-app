import type { ShadowPickFighterFacts, ShadowPickFightFacts } from "./types";

function formatFighter(label: "fighter1" | "fighter2", f: ShadowPickFighterFacts): string {
  return `${label} = ${f.name} (id=${f.fighterId})
  Elo: ${Math.round(f.eloRating)} (${f.ratedFightCount} rated UFC fights)
  Reach: ${f.reachCm ?? "unknown"}cm, Height: ${f.heightCm ?? "unknown"}cm, Age: ${f.ageYears ?? "unknown"}
  Record by method: ${f.sherdogWins} wins, ${f.sherdogLosses} losses
  Scouting read -- form: ${f.dossier.formTrajectory} style: ${f.dossier.stylisticProfile} durability: ${f.dossier.durability} layoff: ${f.dossier.layoff}
  Recent bouts: ${f.recentBouts.length > 0 ? f.recentBouts.map((b) => `id=${b.id} ${b.result.toUpperCase()} vs ${b.opponentName}`).join("; ") : "(none on file)"}
  Open rumour flags: ${f.openFlags.length > 0 ? f.openFlags.map((fl) => `id=${fl.id} (${fl.category}): ${fl.summary}`).join("; ") : "(none)"}`;
}

function formatFight(fight: ShadowPickFightFacts): string {
  const price =
    fight.fighter1Price !== null && fight.fighter2Price !== null
      ? `Market decimal odds: fighter1=${fight.fighter1Price}, fighter2=${fight.fighter2Price}`
      : "No market price available for this fight yet.";
  return `--- Fight id=${fight.fightId} ---
${formatFighter("fighter1", fight.fighter1)}
${formatFighter("fighter2", fight.fighter2)}
${price}`;
}

/**
 * One call for the whole card (N8's single map unit) -- the plan's own
 * reasoning: a card-level call can reason about cross-fight consistency a
 * per-fight call structurally cannot see. Every numeric fact given here
 * must be restated verbatim in the response (rules 1-2 below) --
 * shadowPickClaimChecks.ts's numericRestatementMatches check is the
 * cheapest, most valuable check in the phase precisely because it catches
 * a model reasoning fluently from a number it misread.
 */
export function buildShadowPicksPrompt(fights: ShadowPickFightFacts[]): string {
  const fightsText = fights.map(formatFight).join("\n\n");

  return `You are proposing shadow-only scouting adjustments for an MMA fight card, for measurement purposes -- nothing you write here affects any real pick. Everything below is real, on-record data -- do not invent facts not stated here.

${fightsText}

For EACH fight above, propose:
1. restated: repeat every numeric fact given for both fighters EXACTLY as given -- elo (the rounded integer shown), reach, height, age, wins, losses, and market price (or null if none was given). This is a restatement task, not a computation -- copy the numbers, do not adjust them.
2. deltas: four SIGNED, SMALL probability shifts toward fighter1 (positive favors fighter1, negative favors fighter2), each grounded in the scouting reads and evidence above, one per signal:
   - rumours: at most ±0.12
   - elo: at most ±0.15
   - size: at most ±0.06
   - age: at most ±0.04
   These four must sum to at most ±0.25 combined.
3. freeProbabilityFighter1: your own independent, unconstrained estimate (strictly between 0 and 1) of fighter1's win probability, informed by everything above but not mechanically derived from the deltas.
4. citedBoutIds / citedFlagIds: only ids that appear in the bout/flag lists above for either fighter in this fight -- omit entirely (empty array) if you relied on none.
5. reasoning: one or two plain sentences.

Rules, all strict:
- Every restated numeric must exactly match what was given above -- never round differently, never estimate a value that was stated as unknown/null.
- Never cite a bout or flag id not shown above.
- Never let the four deltas sum past ±0.25 combined.

Return JSON exactly in this shape, one entry per fight, nothing else:
{"picks": [{"fightId": "<id>", "restated": {"fighter1Elo": <n>, "fighter2Elo": <n>, "fighter1Reach": <n|null>, "fighter2Reach": <n|null>, "fighter1Height": <n|null>, "fighter2Height": <n|null>, "fighter1Age": <n|null>, "fighter2Age": <n|null>, "fighter1Wins": <n>, "fighter1Losses": <n>, "fighter2Wins": <n>, "fighter2Losses": <n>, "fighter1Price": <n|null>, "fighter2Price": <n|null>}, "deltas": {"rumours": <n>, "elo": <n>, "size": <n>, "age": <n>}, "freeProbabilityFighter1": <n>, "citedBoutIds": ["<id>", ...], "citedFlagIds": ["<id>", ...], "reasoning": "<1-2 sentences>"}, ...]}`;
}
