import type { OddsEvent } from "./types";

const BASE_URL = "https://api.the-odds-api.com/v4";

// Bookmaker chosen 2026-09-01 (CHANGES.md Phase 20), replacing the 1xBet
// choice from Phase 16: verified live that BetOnline.ag covers 89% of the
// MMA feed (56/63 events) against 1xBet's 54% (34/63), and is the only
// book of those checked that cleanly prices both UFC and DWCS -- 1xBet
// had zero DWCS coverage. Region is empirically irrelevant once
// `bookmakers=` is explicit: identical event/coverage counts were
// confirmed across all four (us/eu/uk/au). "us" is kept for
// readability -- BetOnline.ag is a US-facing book, even though the
// parameter doesn't change what comes back.
const SPORT = "mma_mixed_martial_arts";
const REGION = "us";
const BOOKMAKER = "betonlineag";

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
