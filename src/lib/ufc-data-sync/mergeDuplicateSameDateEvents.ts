import type { SupabaseClient } from "@supabase/supabase-js";
import { planEventMerges, type MergeFightInput } from "./planEventMerges";
import { selectAllPages } from "../supabase/selectAllPages";
// Same reason sweepLatentDisputedOpponents.ts reaches into lib/elo/:
// deleting a fight row can orphan a fighter_elo_history row, and a full
// rebuild is simpler and more obviously correct than hand-patching
// ratings. (In practice K1 skips any settled loser fight, so there is
// usually nothing rated to clear -- the call stays a cheap no-op.)
import { recomputeEloRatings } from "../elo/recomputeEloRatings";

export interface MergeDuplicateEventsSummary {
  eventsScanned: number;
  duplicateClustersMerged: number;
  loserEventsMerged: number;
  fightsDeleted: number;
  eloRowsCleared: number;
  eloRecomputed: boolean;
  skipped: { event_date: string; eventIds: string[]; reason: string }[];
}

// picks, odds_snapshots, rumour_flags and data_conflicts all FK-reference
// fights.id with RESTRICT / NO ACTION (and odds_snapshots is immutable by
// trigger). Any of them present means the loser fight cannot be deleted
// here -- planEventMerges skips the whole cluster and it becomes a
// supabase/data-fixes/ job instead.
const BLOCKING_REF_TABLES = ["picks", "odds_snapshots", "rumour_flags", "data_conflicts"] as const;

/**
 * K1: consolidates the "one real card, two `events` rows" duplicates that
 * upsertEvent.ts's (date, folded-name) dedup keeps missing -- a source
 * renaming the card, or the two sources naming it differently. Runs at
 * the tail of every schedule sync (syncSchedule.ts) and is also runnable
 * on its own (`npm run events:merge-duplicates`).
 *
 * All the judgement lives in planEventMerges (pure, tested). This applies
 * the plan: point `events.merged_into` at the survivor, then clear the
 * loser events' fights (with their Elo-history rows), then rebuild Elo
 * once if any rated fight was removed. Idempotent -- a card already
 * consolidated has one non-merged row and produces no plan next pass.
 *
 * **No wrapping transaction** (the supabase-js client has no multi-
 * statement transaction; matching sweepLatentDisputedOpponents.ts). The
 * `merged_into` update is deliberately FIRST so that a failure in a later
 * step leaves the loser already hidden from every date-range query and
 * excluded from the next run's clustering -- the worst case is a hidden
 * event with a few unreferenced orphan fight rows, not a visible empty
 * card or a re-merge loop. `recompute_elo` (daily, settlement chain)
 * repairs any half-cleared Elo history regardless.
 */
export async function mergeDuplicateSameDateEvents(
  supabase: SupabaseClient,
): Promise<MergeDuplicateEventsSummary> {
  const summary: MergeDuplicateEventsSummary = {
    eventsScanned: 0,
    duplicateClustersMerged: 0,
    loserEventsMerged: 0,
    fightsDeleted: 0,
    eloRowsCleared: 0,
    eloRecomputed: false,
    skipped: [],
  };

  // Whole-table reads -> selectAllPages, never a bare .select(): PostgREST
  // truncates a large response to db-max-rows with no error, and a
  // truncated `fights` read here would drop ~half of every event's bouts
  // (random-UUID ids), silently un-linking a duplicate -- or worse,
  // deleting the visible half of a loser event and orphaning the rest.
  const events = await selectAllPages<{ id: string; event_date: string }>(
    supabase,
    "events",
    "id, event_date",
    (q) => q.is("merged_into", null),
  );
  summary.eventsScanned = events.length;

  const datesWithDupes = new Set(
    [...countBy(events.map((e) => e.event_date)).entries()].filter(([, n]) => n > 1).map(([date]) => date),
  );
  if (datesWithDupes.size === 0) return summary;

  const liveEventIds = new Set(events.map((e) => e.id));
  const eventDateById = new Map(events.map((e) => [e.id, e.event_date]));

  const allFights = await selectAllPages<{
    id: string;
    event_id: string;
    fighter1_id: string;
    fighter2_id: string;
    bout_order: number | null;
    winner_id: string | null;
    settled_at: string | null;
  }>(supabase, "fights", "id, event_id, fighter1_id, fighter2_id, bout_order, winner_id, settled_at");

  // Only fights on a contested date, and only under a live (non-merged)
  // event, are candidates -- everything else is irrelevant to the plan.
  const candidateFights = allFights.filter(
    (f) => liveEventIds.has(f.event_id) && datesWithDupes.has(eventDateById.get(f.event_id) ?? ""),
  );
  const candidateIds = candidateFights.map((f) => f.id);
  if (candidateIds.length === 0) return summary;

  const blockedFightIds = new Set<string>();
  for (const table of BLOCKING_REF_TABLES) {
    // Also paged: odds_snapshots accumulates one immutable row per fight
    // per poll, so a duplicate mispriced for a couple of weeks can push a
    // bare `.in()` past the response cap -- and a missed odds row reads as
    // "not blocked", which is the one mistake that turns into a failed
    // RESTRICT delete mid-merge.
    const rows = await selectAllPages<{ id: string; fight_id: string | null }>(
      supabase,
      table,
      "id, fight_id",
      (q) => q.in("fight_id", candidateIds),
    );
    for (const row of rows) {
      if (row.fight_id) blockedFightIds.add(row.fight_id);
    }
  }

  const planFights: MergeFightInput[] = candidateFights.map((f) => ({
    id: f.id,
    event_id: f.event_id,
    fighter1_id: f.fighter1_id,
    fighter2_id: f.fighter2_id,
    bout_order: f.bout_order ?? null,
    winner_id: f.winner_id ?? null,
    settled_at: f.settled_at ?? null,
    hasBlockingRefs: blockedFightIds.has(f.id),
  }));
  const planEvents = events
    .filter((e) => datesWithDupes.has(e.event_date))
    .map((e) => ({ id: e.id, event_date: e.event_date }));

  const { plans, skipped } = planEventMerges(planEvents, planFights);
  summary.skipped = skipped;

  for (const plan of plans) {
    const { error: mergeError } = await supabase
      .from("events")
      .update({ merged_into: plan.keeperEventId })
      .in("id", plan.loserEventIds);
    if (mergeError) throw mergeError;

    if (plan.deleteFightIds.length > 0) {
      const { data: clearedElo, error: eloError } = await supabase
        .from("fighter_elo_history")
        .delete()
        .in("fight_id", plan.deleteFightIds)
        .select("id");
      if (eloError) throw eloError;
      summary.eloRowsCleared += clearedElo?.length ?? 0;

      const { error: deleteError } = await supabase.from("fights").delete().in("id", plan.deleteFightIds);
      if (deleteError) throw deleteError;
      summary.fightsDeleted += plan.deleteFightIds.length;
    }

    summary.duplicateClustersMerged++;
    summary.loserEventsMerged += plan.loserEventIds.length;
  }

  if (summary.eloRowsCleared > 0) {
    await recomputeEloRatings(supabase);
    summary.eloRecomputed = true;
  }

  return summary;
}

function countBy(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}
