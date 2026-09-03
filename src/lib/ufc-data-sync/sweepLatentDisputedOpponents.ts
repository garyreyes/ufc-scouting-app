import type { SupabaseClient } from "@supabase/supabase-js";
import { clusterFightsBySharedFighter } from "./clusterFightsBySharedFighter";
// lib/ufc-data-sync/ importing from lib/elo/ is new, but the reason is
// narrow and specific: deleting a candidate fight row here can orphan a
// real fighter_elo_history row (found live, 2026-09-03 -- some of these
// pre-A2 duplicates carry a genuine recorded result, which I1's Elo
// recompute already rated). A full rebuild at the end is simpler and
// more obviously correct than trying to hand-patch individual ratings.
import { recomputeEloRatings } from "../elo/recomputeEloRatings";

export interface SweepSummary {
  fightsChecked: number;
  clustersFound: number;
  pairsResolved: number;
  eloRowsClearedForDeletedFights: number;
  multiWayClustersSkipped: { fightIds: string[] }[];
}

interface FightRow {
  id: string;
  external_id: string;
  event_id: string;
  fighter1_id: string;
  fighter2_id: string;
  winner_id: string | null;
  method: string | null;
  round: number | null;
  weight_class: string | null;
  bout_order: number | null;
}

/**
 * I2c: A2's disputed-opponent detection (Fork 5) only ever runs when
 * upsertFight is CALLED -- it has no mechanism to retroactively check
 * fights that already existed before it shipped (2026-09-01). A sweep
 * across all 158 production fights found 13 pairwise "shares exactly
 * one fighter" matches, all on events from before that date, none ever
 * caught. This is a one-time backfill, not a recurring job -- there is
 * nothing left for it to find once run, since the live path has covered
 * every write since A2 shipped.
 *
 * **Only resolves clean 2-fight clusters, and does so by reusing the
 * EXACT existing disputed_opponent machinery** (DisputedOpponentCard,
 * resolveDisputedOpponentAction, buildDisputedOpponentResolution) --
 * zero new UI. The one real difference from the live path: there, a
 * "candidate" only ever exists as JSON inside `details`, because
 * upsertFight's conflict branch runs INSTEAD OF an insert. Here, BOTH
 * fights in a pair already exist as real rows -- so the candidate's own
 * row is deleted as part of opening the conflict (snapshotting its full
 * data into `details` first), or resolving through the existing action
 * would silently leave an orphan duplicate no matter which side the
 * owner picks. Confirmed live before ANY of this runs: zero
 * odds_snapshots/picks/rumour_flags/data_conflicts reference any of
 * these rows, so nothing else can be broken by the delete.
 *
 * **A cluster of 3+ fights is NOT resolved.** The existing
 * disputed_opponent shape is exactly one "kept" row vs one "candidate" --
 * production has a real 3-fight cluster ("Gauge Young" implicated across
 * three rows, only two of which are the same bout under a nickname
 * variant) that doesn't fit that shape without real design work this
 * pass doesn't do. Reported, not guessed at.
 */
export async function sweepLatentDisputedOpponents(supabase: SupabaseClient): Promise<SweepSummary> {
  const summary: SweepSummary = {
    fightsChecked: 0,
    clustersFound: 0,
    pairsResolved: 0,
    eloRowsClearedForDeletedFights: 0,
    multiWayClustersSkipped: [],
  };

  const { data: fights, error } = await supabase
    .from("fights")
    .select("id, external_id, event_id, fighter1_id, fighter2_id, winner_id, method, round, weight_class, bout_order");
  if (error) throw error;
  const allFights = (fights ?? []) as FightRow[];
  summary.fightsChecked = allFights.length;

  const byEvent = new Map<string, FightRow[]>();
  for (const f of allFights) {
    const list = byEvent.get(f.event_id) ?? [];
    list.push(f);
    byEvent.set(f.event_id, list);
  }

  const byId = new Map(allFights.map((f) => [f.id, f]));

  for (const eventFights of byEvent.values()) {
    const clusters = clusterFightsBySharedFighter(eventFights);

    for (const clusterIds of clusters) {
      summary.clustersFound++;

      if (clusterIds.length !== 2) {
        summary.multiWayClustersSkipped.push({ fightIds: clusterIds });
        continue;
      }

      // Deterministic, arbitrary tie-break -- correctness doesn't depend
      // on which side is "kept": the owner sees both real options
      // either way, and buildDisputedOpponentResolution copies the
      // candidate's winner/method/round/weight_class/bout_order onto
      // the kept row if that's the one chosen, so the surviving row
      // ends up correct regardless of which id happened to sort lower.
      const [keptId, candidateId] = [...clusterIds].sort();
      const kept = byId.get(keptId)!;
      const candidate = byId.get(candidateId)!;

      const { data: existingConflict, error: existingError } = await supabase
        .from("data_conflicts")
        .select("id")
        .eq("kind", "disputed_opponent")
        .eq("fight_id", kept.id)
        .is("resolved_at", null)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existingConflict) continue; // already surfaced, e.g. a repeat run

      // The candidate row may already carry a real, rated result (found
      // live: production has exactly this shape) -- fighter_elo_history
      // has an FK on fight_id, so the delete below would otherwise be
      // rejected outright. Cleared explicitly rather than guessed at;
      // the full recomputeEloRatings() call after the loop is what makes
      // every remaining rating correct again, not this deletion alone.
      const { data: clearedElo, error: eloClearError } = await supabase
        .from("fighter_elo_history")
        .delete()
        .eq("fight_id", candidate.id)
        .select("id");
      if (eloClearError) throw eloClearError;
      summary.eloRowsClearedForDeletedFights += clearedElo?.length ?? 0;

      const { error: deleteError } = await supabase.from("fights").delete().eq("id", candidate.id);
      if (deleteError) throw deleteError;

      const { error: insertError } = await supabase.from("data_conflicts").insert({
        kind: "disputed_opponent",
        fight_id: kept.id,
        details: {
          candidate_external_id: candidate.external_id,
          candidate_fighter1_id: candidate.fighter1_id,
          candidate_fighter2_id: candidate.fighter2_id,
          winner_id: candidate.winner_id,
          method: candidate.method,
          round: candidate.round,
          weight_class: candidate.weight_class,
          bout_order: candidate.bout_order,
        },
      });
      if (insertError) throw insertError;

      summary.pairsResolved++;
    }
  }

  // Rebuild from scratch rather than trust the per-pair clears above to
  // have been sufficient -- recomputeEloRatings.ts already does a full
  // delete-then-reinsert by design (settlement can arrive out of
  // chronological order), so calling it once here is simpler and more
  // obviously correct than reasoning about whether every affected
  // fighter's downstream ratings were individually patched right.
  // A no-op, cheaply, when nothing above actually removed a rated fight.
  if (summary.pairsResolved > 0) {
    await recomputeEloRatings(supabase);
  }

  return summary;
}
