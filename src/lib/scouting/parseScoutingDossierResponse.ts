import type { ScoutingDossierClaim } from "./types";

interface RawResponse {
  formTrajectory?: unknown;
  stylisticProfile?: unknown;
  durability?: unknown;
  layoff?: unknown;
  citedBoutIds?: unknown;
  citedFlagIds?: unknown;
}

function requireString(value: unknown, field: string, raw: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Scouting dossier response missing/invalid "${field}": ${JSON.stringify(raw)}`);
  }
  return value.trim();
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * Parses one fighter's response (`buildScoutingDossierPrompt.ts` is a
 * per-fighter prompt, so this is a single object, not an array).
 * `scoutingDossierChecks.ts` (via `runMapReduce`'s `verifyMapClaims` step)
 * enforces every real-world fact this claims -- this only shapes the JSON.
 *
 * Throws on a missing/malformed prose field -- the caller
 * (`generateScoutingDossiers.ts`, via `runMapReduce`) treats that as a map
 * failure and falls back to writing no dossier for this fighter this run,
 * never silently substituting empty prose as if the model actually wrote
 * one. Citation arrays are treated more leniently at parse time (a
 * missing/malformed array becomes `[]`, never a throw) since an empty
 * citation list is itself a valid, honest answer -- `scoutingDossierChecks.ts`
 * is what actually enforces the citations are real, not this function.
 */
export function parseScoutingDossierResponse(raw: unknown, fighterId: string): ScoutingDossierClaim[] {
  const response = raw as RawResponse;
  if (!response || typeof response !== "object") {
    throw new Error(`Scouting dossier response is not an object: ${JSON.stringify(raw)}`);
  }

  return [
    {
      fighterId,
      formTrajectory: requireString(response.formTrajectory, "formTrajectory", raw),
      stylisticProfile: requireString(response.stylisticProfile, "stylisticProfile", raw),
      durability: requireString(response.durability, "durability", raw),
      layoff: requireString(response.layoff, "layoff", raw),
      citedBoutIds: stringArray(response.citedBoutIds),
      citedFlagIds: stringArray(response.citedFlagIds),
    },
  ];
}
