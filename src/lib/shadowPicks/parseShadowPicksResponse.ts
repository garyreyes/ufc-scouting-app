import type { ShadowPickClaim, ShadowPickNumericRestatement } from "./types";

interface RawRestated {
  fighter1Elo?: unknown;
  fighter2Elo?: unknown;
  fighter1Reach?: unknown;
  fighter2Reach?: unknown;
  fighter1Height?: unknown;
  fighter2Height?: unknown;
  fighter1Age?: unknown;
  fighter2Age?: unknown;
  fighter1Wins?: unknown;
  fighter1Losses?: unknown;
  fighter2Wins?: unknown;
  fighter2Losses?: unknown;
  fighter1Price?: unknown;
  fighter2Price?: unknown;
}

interface RawPick {
  fightId?: unknown;
  restated?: RawRestated;
  deltas?: { rumours?: unknown; elo?: unknown; size?: unknown; age?: unknown };
  freeProbabilityFighter1?: unknown;
  citedBoutIds?: unknown;
  citedFlagIds?: unknown;
  reasoning?: unknown;
}

interface RawResponse {
  picks?: unknown;
}

function requireString(value: unknown, field: string, raw: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Shadow picks response missing/invalid "${field}": ${JSON.stringify(raw)}`);
  }
  return value.trim();
}

function requireNumber(value: unknown, field: string, raw: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Shadow picks response missing/invalid "${field}": ${JSON.stringify(raw)}`);
  }
  return value;
}

// Restated numerics use null-or-number, never a throw on null -- a fighter
// with genuinely unknown reach/height/age/price is a legitimate case
// (buildShadowPicksPrompt.ts states it as null), and shadowPickClaimChecks.ts
// is what actually verifies a restated null matches a real null.
function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function parseRestated(raw: RawRestated | undefined, rawPick: unknown): ShadowPickNumericRestatement {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Shadow picks response missing/invalid "restated": ${JSON.stringify(rawPick)}`);
  }
  return {
    fighter1Elo: requireNumber(raw.fighter1Elo, "restated.fighter1Elo", rawPick),
    fighter2Elo: requireNumber(raw.fighter2Elo, "restated.fighter2Elo", rawPick),
    fighter1Reach: nullableNumber(raw.fighter1Reach),
    fighter2Reach: nullableNumber(raw.fighter2Reach),
    fighter1Height: nullableNumber(raw.fighter1Height),
    fighter2Height: nullableNumber(raw.fighter2Height),
    fighter1Age: nullableNumber(raw.fighter1Age),
    fighter2Age: nullableNumber(raw.fighter2Age),
    fighter1Wins: requireNumber(raw.fighter1Wins, "restated.fighter1Wins", rawPick),
    fighter1Losses: requireNumber(raw.fighter1Losses, "restated.fighter1Losses", rawPick),
    fighter2Wins: requireNumber(raw.fighter2Wins, "restated.fighter2Wins", rawPick),
    fighter2Losses: requireNumber(raw.fighter2Losses, "restated.fighter2Losses", rawPick),
    fighter1Price: nullableNumber(raw.fighter1Price),
    fighter2Price: nullableNumber(raw.fighter2Price),
  };
}

/**
 * Parses the whole-card response (`buildShadowPicksPrompt.ts` is a
 * single card-wide prompt, so this is `{ picks: [...] }`, one entry per
 * fight -- unlike N7's per-fighter single-object shape).
 * `shadowPickClaimChecks.ts` (via `runMapReduce`'s `verifyMapClaims` step)
 * enforces every real-world fact this claims -- this only shapes the JSON.
 *
 * Throws on any malformed pick -- the caller (`generateShadowPicks.ts`,
 * via `runMapReduce`) treats a parse failure as a map failure for the
 * WHOLE card and falls back to writing no shadow picks this run, never
 * silently substituting a partial or fabricated set. Citation arrays stay
 * lenient (missing/malformed -> `[]`) since an empty citation list is
 * itself a valid, honest answer -- matches parseScoutingDossierResponse.ts's
 * own convention.
 */
export function parseShadowPicksResponse(raw: unknown): ShadowPickClaim[] {
  const response = raw as RawResponse;
  if (!response || typeof response !== "object" || !Array.isArray(response.picks)) {
    throw new Error(`Shadow picks response is not an object with a "picks" array: ${JSON.stringify(raw)}`);
  }

  return (response.picks as RawPick[]).map((pick) => ({
    fightId: requireString(pick.fightId, "fightId", pick),
    restated: parseRestated(pick.restated, pick),
    deltas: {
      rumours: requireNumber(pick.deltas?.rumours, "deltas.rumours", pick),
      elo: requireNumber(pick.deltas?.elo, "deltas.elo", pick),
      size: requireNumber(pick.deltas?.size, "deltas.size", pick),
      age: requireNumber(pick.deltas?.age, "deltas.age", pick),
    },
    freeProbabilityFighter1: requireNumber(pick.freeProbabilityFighter1, "freeProbabilityFighter1", pick),
    citedBoutIds: stringArray(pick.citedBoutIds),
    citedFlagIds: stringArray(pick.citedFlagIds),
    reasoning: requireString(pick.reasoning, "reasoning", pick),
  }));
}
