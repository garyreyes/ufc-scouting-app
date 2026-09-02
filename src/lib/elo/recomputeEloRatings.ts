import type { SupabaseClient } from "@supabase/supabase-js";
import { computeEloHistory } from "./computeEloHistory";
import type { SettledFightForElo } from "./computeEloHistory";

export interface RecomputeEloSummary {
  fightsProcessed: number;
  snapshotsWritten: number;
}

const CHUNK_SIZE = 500;

/**
 * The I/O half of the Elo feature -- computeEloHistory.ts owns the pure
 * math, this owns fetching every settled fight and replacing
 * fighter_elo_history with the freshly recomputed result.
 *
 * Always a full delete-then-reinsert, never an upsert-only patch. This
 * app's own settlement design (evaluateFightSettlement.ts's 24h-timeout
 * and disputed-opponent handling) means fights can settle OUT OF
 * CHRONOLOGICAL ORDER relative to each other -- a fight can sit pending
 * while later fights for the same fighters already settled. An
 * upsert-only approach would silently rate that late-settling fight
 * using the fighters' CURRENT ratings instead of what they actually were
 * at that point in history, corrupting every rating computed since for
 * both fighters. A full rebuild from computeEloHistory's own
 * chronological sort is the only way to stay correct through that.
 *
 * Called from runSettlementJobsOnce.ts right after D1/D2 -- the exact
 * moment a new result (or a previously-pending one) is discovered is the
 * exact moment ratings need to move.
 */
export async function recomputeEloRatings(supabase: SupabaseClient): Promise<RecomputeEloSummary> {
  const { data: fights, error: fightsError } = await supabase
    .from("fights")
    .select("id, fighter1_id, fighter2_id, winner_id, method, settled_at")
    .not("settled_at", "is", null);
  if (fightsError) throw fightsError;

  const settledFights: SettledFightForElo[] = (fights ?? []).map((f) => ({
    fightId: f.id as string,
    fighter1Id: f.fighter1_id as string,
    fighter2Id: f.fighter2_id as string,
    winnerId: f.winner_id as string | null,
    method: f.method as string | null,
    settledAt: f.settled_at as string,
  }));

  const snapshots = computeEloHistory(settledFights);

  // A real filter (id is never null, so this matches every row) rather
  // than an unfiltered delete -- clearer intent than a placeholder-uuid
  // .neq() trick.
  const { error: deleteError } = await supabase.from("fighter_elo_history").delete().not("id", "is", null);
  if (deleteError) throw deleteError;

  for (let i = 0; i < snapshots.length; i += CHUNK_SIZE) {
    const chunk = snapshots.slice(i, i + CHUNK_SIZE).map((s) => ({
      fighter_id: s.fighterId,
      fight_id: s.fightId,
      rating: s.rating,
      fight_settled_at: s.fightSettledAt,
    }));
    const { error: insertError } = await supabase.from("fighter_elo_history").insert(chunk);
    if (insertError) throw insertError;
  }

  return { fightsProcessed: settledFights.length, snapshotsWritten: snapshots.length };
}
