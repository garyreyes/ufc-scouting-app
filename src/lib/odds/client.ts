import type { OddsEvent } from "./types";

const BASE_URL = "https://api.the-odds-api.com/v4";

// Verified live 2026-09-01 (CHANGES.md Phase 16, Phase 20): BetOnline.ag
// is bookmaker key `betonlineag`, decimal is the API default, and MMA
// h2h from this bookmaker is a clean 2-way market (see parseOutcomes.ts
// for why the Draw-discard logic is kept anyway).
const SPORT = "mma_mixed_martial_arts";
const REGION = "us";
const BOOKMAKER = "betonlineag";

// Pure, so the URL shape itself is testable without touching the network
// -- this is exactly what was missing when a real bug shipped here
// undetected: `new URL(path, base)` treats a leading "/" in `path` as
// absolute-from-origin, silently discarding BASE_URL's own "/v4" instead
// of appending to it. Found live 2026-09-01 (B4) the first time this
// function was actually invoked end-to-end -- neither B1's curl checks
// nor B3's pure-function tests ever exercised this code path. Single-
// argument `new URL(fullString)` avoids the whole class of bug: there is
// no base to resolve against, so there is nothing to silently drop.
export function buildOddsUrl(apiKey: string): URL {
  const url = new URL(`${BASE_URL}/sports/${SPORT}/odds`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("regions", REGION);
  url.searchParams.set("markets", "h2h");
  url.searchParams.set("oddsFormat", "decimal");
  url.searchParams.set("bookmakers", BOOKMAKER);
  return url;
}

/**
 * Fetches live MMA odds for the configured bookmaker. Costs 1 credit
 * per call (confirmed live via x-requests-remaining), regardless of how
 * many events come back, so this is cheap to call once per sync run
 * rather than per fight.
 */
export async function fetchMmaOdds(): Promise<OddsEvent[]> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ODDS_API_KEY");
  }

  const url = buildOddsUrl(apiKey);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`The Odds API request failed: ${res.status} ${await res.text()}`);
  }

  return (await res.json()) as OddsEvent[];
}
