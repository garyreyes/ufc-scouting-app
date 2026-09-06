import { fetchSherdogHtml, type FetchOptions } from "./client";
import { parseSearchResults, type SherdogSearchCandidate } from "./parseSearch";
import { sherdogSearchQueries } from "./sherdogSearchQueries";

/**
 * Name -> Sherdog search candidates, via the fightfinder page.
 *
 * Sherdog's fightfinder misses a name with a diacritic or a generational
 * suffix ("Édgar Cháirez", "Michael Aswell Jr." both returned nothing
 * live 2026-09-07), so this tries the raw name first and then a few
 * normalized variants (see sherdogSearchQueries.ts), stopping at the
 * first query that returns any candidate. Each attempt is one throttled
 * request; a fighter genuinely absent from Sherdog costs the full set
 * (still only ~4 requests, and Sherdog is unmetered).
 */
export async function searchSherdogFighters(
  name: string,
  opts?: FetchOptions,
): Promise<SherdogSearchCandidate[]> {
  for (const query of sherdogSearchQueries(name)) {
    const html = await fetchSherdogHtml(
      `/stats/fightfinder?SearchTxt=${encodeURIComponent(query)}`,
      opts,
    );
    const candidates = parseSearchResults(html);
    if (candidates.length > 0) return candidates;
  }
  return [];
}
