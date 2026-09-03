import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchFighterSeasonHistory } from "./fetchFightHistory";
import { processFightHistoryEntries } from "./processFightHistoryEntries";

// The free tier's own floor and ceiling for fighter-scoped history --
// confirmed live, G1b: 2022-2024 serve real data, 2025/2026 are refused
// outright ("Free plans do not have access to this season, try from
// 2022 to 2024"). Never pass anything outside this list.
export const BACKFILL_SEASONS = ["2022", "2023", "2024"];

// A generous, deliberately conservative batch size. Each fighter costs
// 3 requests for the season fetches themselves, plus one more per
// UNIQUE fighter id (this fighter and every opponent found) that
// processFightHistoryEntries then re-fetches via fetchFighter -- a
// fighter with a long, active 2022-2024 career could plausibly cost
// 10+ requests on its own. 5 fighters/run keeps a worst-case run well
// under half the shared 100/day API-Sports budget, alongside the
// twice-daily results sync (~10-15/run) and I2's own daily enrichment
// job (~40/run while its queue still has fighters left in it).
export const DEFAULT_BATCH_SIZE = 5;

export interface BackfillFightHistorySummary {
  fightersAttempted: number;
  eventsWritten: number;
  fightersWritten: number;
  fightsWritten: number;
  failed: number;
}

/**
 * I3: backfills 2022-2024 fight history for fighters I2 already
 * enriched -- the opponent-quality signal the user originally asked
 * for in G1b, now buildable because I2 gave the intern's known
 * fighters real API-Sports ids to look up. Every opponent discovered
 * along the way gets its own fighters/fights rows too
 * (processFightHistoryEntries), so Elo can rate them as real nodes in
 * the win/loss graph -- but their OWN history is deliberately NOT
 * chased recursively in this same run. That would make the job
 * unbounded. If a discovered opponent later becomes independently
 * enriched-and-queued (they get booked on a real card and go through
 * I2 themselves, or this job runs again later), they reach the front
 * of this same queue on their own.
 *
 * **Self-throttling and resumable with no new queue table**, same
 * pattern as I2's enrichFighters.ts: the query is `external_id is not
 * null and history_backfilled_at is null` -- "already enriched, not
 * yet checked" IS the queue. Checked once regardless of outcome, so a
 * fighter whose 2022-2024 history is genuinely empty (debuted after
 * 2024, or only ever fought before the free tier's floor) is never
 * re-fetched.
 */
export async function backfillFightHistory(
  supabase: SupabaseClient,
  batchSize: number = DEFAULT_BATCH_SIZE,
): Promise<BackfillFightHistorySummary> {
  const summary: BackfillFightHistorySummary = {
    fightersAttempted: 0,
    eventsWritten: 0,
    fightersWritten: 0,
    fightsWritten: 0,
    failed: 0,
  };

  const { data: candidates, error } = await supabase
    .from("fighters")
    .select("id, name, external_id")
    .not("external_id", "is", null)
    .is("history_backfilled_at", null)
    .limit(batchSize);
  if (error) throw error;
  if (!candidates || candidates.length === 0) return summary;

  for (const fighter of candidates) {
    summary.fightersAttempted++;
    const fighterId = fighter.id as string;
    const externalId = fighter.external_id as string;
    const name = fighter.name as string;

    try {
      // Caught per FIGHTER, not per season -- if one season's request
      // fails, this fighter's whole attempt is abandoned and
      // history_backfilled_at is never set, so all three seasons are
      // simply re-fetched next run. A little redundant work on a
      // transient failure, same tradeoff enrichFighters.ts already
      // makes at the per-fighter level, and simpler than tracking
      // partial per-season success for a case this rare.
      const entries = [];
      for (const season of BACKFILL_SEASONS) {
        entries.push(...(await fetchFighterSeasonHistory(externalId, season)));
      }

      const result = await processFightHistoryEntries(supabase, entries);
      summary.eventsWritten += result.eventCount;
      summary.fightersWritten += result.fighterCount;
      summary.fightsWritten += result.fightCount;

      const { error: touchError } = await supabase
        .from("fighters")
        .update({ history_backfilled_at: new Date().toISOString() })
        .eq("id", fighterId);
      if (touchError) throw touchError;
    } catch (err) {
      summary.failed++;
      console.error(`History backfill failed for fighter ${fighterId} (${name}):`, err);
    }
  }

  return summary;
}
