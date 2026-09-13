import type { SupabaseClient } from "@supabase/supabase-js";
import { planCardReconciliation, type ReconciliationFight } from "./planCardReconciliation";

export type ReconciliationSkipReason =
  | "malformed_bouts"
  | "no_bouts"
  | "too_few_bouts"
  | "event_in_past";

export interface ReconciliationSummary {
  skipped: boolean;
  skipReason: ReconciliationSkipReason | null;
  markedMissing: number;
  cancelled: number;
  clearedMissing: number;
}

interface FightRow {
  id: string;
  external_id: string;
  settled_at: string | null;
  wikipedia_missing_since: string | null;
}

const SKIPPED: (reason: ReconciliationSkipReason) => ReconciliationSummary = (reason) => ({
  skipped: true,
  skipReason: reason,
  markedMissing: 0,
  cancelled: 0,
  clearedMissing: 0,
});

/**
 * M2: the I/O wrapper around planCardReconciliation.ts's pure judgment --
 * reads this event's existing Wikipedia-sourced fights, decides whether
 * the fresh parse is trustworthy enough to act on at all, and if so
 * applies each action planCardReconciliation returns.
 *
 * `parsedBoutCount`/`skippedBoutCount` come from fetchSchedule.ts's fresh
 * parse of THIS run's page. Reconciliation is skipped entirely -- no
 * writes, not even markMissing -- when:
 *   - `eventDate` is strictly before today (reviewer finding, M2 PR #68):
 *     this function is also reached from refreshRecentEventResults.ts (up
 *     to 30 days after a card) and backfillWikipediaHistory.ts (any
 *     historical card), NOT only syncSchedule.ts's still-upcoming loop.
 *     The whole grace-window design below assumes "missing from the page"
 *     means "pulled from the card" -- true for an upcoming event, false
 *     for a past one, where editors routinely fold results into prose or
 *     trim prelim bouts out of the `{{MMAevent bout}}` template long after
 *     the card happened. A bout still unsettled on a past card for an
 *     unrelated reason (an open disputed_opponent conflict, permanently
 *     disagreeing sources) must never be mistaken for a cancellation just
 *     because a later page edit removed its template block. `>= today`
 *     matches the exact same boundary syncSchedule.ts's own upcoming loop
 *     and selectEventsNeedingResultRefresh.ts's past-window already use --
 *     an event dated today is still a real same-day cancellation
 *     candidate, not "past" yet.
 *   - any bout on the page failed to parse (skippedBoutCount > 0): the
 *     parse itself is unreliable, so a missing bout might just be a
 *     parse failure, not a real absence;
 *   - the parse found zero bouts;
 *   - the parse found fewer than half of this event's existing unsettled
 *     Wikipedia bouts -- the signature of a partial page render, not a
 *     genuine wave of cancellations (a whole card doesn't usually lose
 *     half its bouts between two ~12h-apart syncs).
 * These guards exist because a cancellation VOIDS PICKS -- a false
 * positive here is a real money-affecting mistake, not a cosmetic one.
 */
export async function applyCardReconciliation(
  supabase: SupabaseClient,
  eventId: string,
  eventTitle: string,
  eventDate: string,
  parsedBoutCount: number,
  skippedBoutCount: number,
  presentFightIds: ReadonlySet<string>,
  now: Date = new Date(),
): Promise<ReconciliationSummary> {
  const today = now.toISOString().slice(0, 10);
  if (eventDate < today) return SKIPPED("event_in_past");
  if (skippedBoutCount > 0) return SKIPPED("malformed_bouts");
  if (parsedBoutCount === 0) return SKIPPED("no_bouts");

  const { data: fights, error } = await supabase
    .from("fights")
    .select("id, external_id, settled_at, wikipedia_missing_since")
    .eq("event_id", eventId);
  if (error) throw error;

  const prefix = `wiki:${eventTitle}:`;
  const existingWikiFights = ((fights ?? []) as FightRow[]).filter((f) => f.external_id.startsWith(prefix));

  if (existingWikiFights.length > 0 && parsedBoutCount < existingWikiFights.length / 2) {
    return SKIPPED("too_few_bouts");
  }

  const reconciliationFights: ReconciliationFight[] = existingWikiFights.map((f) => ({
    id: f.id,
    externalId: f.external_id,
    settledAt: f.settled_at,
    wikipediaMissingSince: f.wikipedia_missing_since,
  }));

  const actions = planCardReconciliation(eventTitle, reconciliationFights, presentFightIds, now);

  const summary: ReconciliationSummary = {
    skipped: false,
    skipReason: null,
    markedMissing: 0,
    cancelled: 0,
    clearedMissing: 0,
  };

  for (const action of actions) {
    if (action.action === "markMissing") {
      const { error: updateError } = await supabase
        .from("fights")
        .update({ wikipedia_missing_since: now.toISOString() })
        .eq("id", action.fightId);
      if (updateError) throw updateError;
      summary.markedMissing++;
    } else if (action.action === "clearMissing") {
      const { error: updateError } = await supabase
        .from("fights")
        .update({ wikipedia_missing_since: null })
        .eq("id", action.fightId);
      if (updateError) throw updateError;
      summary.clearedMissing++;
    } else {
      // "cancel" -- deliberately never writes method/round. See
      // 0044_cancelled_fights.sql's own comment: a fake method string
      // would leak into Elo (isResolvedForElo.ts) and records
      // (isNoContestOrAmbiguous.ts) as a rated draw instead of being
      // excluded, since both key off method text, not settled_from.
      const { error: updateError } = await supabase
        .from("fights")
        .update({ settled_at: now.toISOString(), settled_from: "cancelled", winner_id: null })
        .eq("id", action.fightId);
      if (updateError) throw updateError;
      summary.cancelled++;
    }
  }

  return summary;
}
