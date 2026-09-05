import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllPages } from "../supabase/selectAllPages";
import { computeEloHistory } from "./computeEloHistory";
import type { FightForElo } from "./computeEloHistory";
import { isResolvedForElo } from "./isResolvedForElo";

export interface RecomputeEloSummary {
  fightsProcessed: number;
  snapshotsWritten: number;
}

const CHUNK_SIZE = 500;

/**
 * The I/O half of the Elo feature -- computeEloHistory.ts owns the pure
 * math, this owns fetching every resolved fight and replacing
 * fighter_elo_history with the freshly recomputed result.
 *
 * **Scoped by isResolvedForElo, ordered by event date (I1).** It used to
 * read `settled_at IS NOT NULL` ordered by settled_at, which was wrong
 * twice over: production had 57 fights with a recorded winner and ZERO
 * settled fights, so the rebuild ran over an empty set; and settlement
 * order is not chronological order, so even once fights did settle they
 * would have been rated in the wrong sequence. Elo is sequential, so a
 * wrong order silently produces wrong ratings.
 *
 * Filtered in JS rather than SQL so the eligibility rule lives in one
 * tested pure function instead of a PostgREST `.or()` string -- the same
 * "fetch broadly, decide in tested code" split used across this codebase,
 * and cheap at this table's size.
 *
 * Always a full delete-then-reinsert, never an upsert-only patch. Results
 * arrive out of chronological order all the time (a disputed bout settles
 * days after later fights already did; a backfill imports years at once),
 * and an upsert-only approach would rate a late-arriving old fight using
 * the fighters' CURRENT ratings rather than what they were at the time,
 * corrupting every rating computed since for both fighters.
 *
 * Called from runSettlementJobsOnce.ts right after D1/D2 -- the exact
 * moment a new result (or a previously-pending one) is discovered is the
 * exact moment ratings need to move.
 */
export async function recomputeEloRatings(supabase: SupabaseClient): Promise<RecomputeEloSummary> {
  // Paged, not a bare .select() (I5). Both of these are whole-table scans,
  // and PostgREST can cap a response without raising an error -- a
  // truncated read here would rebuild every rating from a partial graph
  // and look completely normal doing it. `fights` passed ~950 rows during
  // the I4 backfill, so this was close to real.
  const fights = await selectAllPages<{
    id: string;
    event_id: string;
    fighter1_id: string;
    fighter2_id: string;
    winner_id: string | null;
    method: string | null;
  }>(supabase, "fights", "id, event_id, fighter1_id, fighter2_id, winner_id, method");

  const events = await selectAllPages<{ id: string; event_date: string | null }>(
    supabase,
    "events",
    "id, event_date",
  );
  const eventDateById = new Map(
    (events ?? []).map((e) => [e.id as string, e.event_date as string | null]),
  );

  const resolvedFights: FightForElo[] = (fights ?? [])
    .map((f) => ({
      fightId: f.id as string,
      fighter1Id: f.fighter1_id as string,
      fighter2Id: f.fighter2_id as string,
      winnerId: f.winner_id as string | null,
      method: f.method as string | null,
      occurredAt: eventDateById.get(f.event_id as string) ?? null,
    }))
    // An event with no date cannot be placed in the sequence at all, and
    // guessing its position would corrupt every rating after it -- same
    // "ambiguous, don't guess" rule computeEloHistory applies to a
    // draw/NC it cannot tell apart.
    .filter((f): f is FightForElo => f.occurredAt !== null && isResolvedForElo(f));

  const snapshots = computeEloHistory(resolvedFights);

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
      fight_occurred_at: s.fightOccurredAt,
    }));
    const { error: insertError } = await supabase.from("fighter_elo_history").insert(chunk);
    if (insertError) throw insertError;
  }

  return { fightsProcessed: resolvedFights.length, snapshotsWritten: snapshots.length };
}
