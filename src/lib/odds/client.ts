import type { OddsEvent } from "./types";

const BASE_URL = "https://api.the-odds-api.com/v4";

// Verified live 2026-09-01 (CHANGES.md Phase 16): 1xBet is bookmaker key
// `onexbet` in the EU region, decimal is the API default, and MMA h2h
// returns three outcomes (see parseOutcomes.ts for the Draw handling).
const SPORT = "mma_mixed_martial_arts";
const REGION = "eu";
const BOOKMAKER = "onexbet";

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

  const url = new URL(`/sports/${SPORT}/odds`, BASE_URL);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("regions", REGION);
  url.searchParams.set("markets", "h2h");
  url.searchParams.set("oddsFormat", "decimal");
  url.searchParams.set("bookmakers", BOOKMAKER);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`The Odds API request failed: ${res.status} ${await res.text()}`);
  }

  return (await res.json()) as OddsEvent[];
}
