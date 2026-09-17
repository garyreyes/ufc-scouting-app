import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllPages } from "../supabase/selectAllPages";
import { isPastSnapshotWindow } from "./snapshotWindow";
import type { FightForMatching } from "./types";

export interface UnpricedFight extends FightForMatching {
  startsAt: string | null;
}

type EmbeddedFight = {
  id: string;
  fighter1: { name: string };
  fighter2: { name: string };
  event: { event_date: string; starts_at: string | null };
};

/**
 * Every fight with no odds_snapshots row yet, no time gate applied --
 * the base query two different consumers filter differently:
 * matchAndSnapshot.ts (via fetchEligibleUnpricedFights below) wants only
 * those past their T-12h window; features/conflicts/api.ts wants ALL of
 * them, scoped instead by an odds event's own date window
 * (lib/odds/matchFights.ts's rankFightMatches), since a low-confidence
 * conflict's candidate picker is about finding which fight an ALREADY-
 * CAPTURED price belongs to, not gating a new capture.
 *
 * M1: both reads are now paged with selectAllPages -- a plain `.select()`
 * silently truncates at PostgREST's row cap, and `fights` (1,044 rows
 * live, 2026-09-13) had already crossed it. 44 fights were invisible to
 * odds matching with no error before this fix.
 *
 * Works with either the service-role admin client or the public anon
 * client -- fights, events, and odds_snapshots are all public-read
 * (0002_grants.sql, 0013_odds_snapshots.sql).
 */
export async function fetchUnpricedFights(supabase: SupabaseClient): Promise<UnpricedFight[]> {
  const alreadyPriced = await selectAllPages<{ id: string; fight_id: string }>(
    supabase,
    "odds_snapshots",
    "id, fight_id",
  );
  const pricedIds = new Set(alreadyPriced.map((row) => row.fight_id));

  // Same PostgREST FK-embed pattern as features/fights/api.ts.
  //
  // M2: `.is("settled_at", null)` -- a cancelled fight (settled_at set,
  // never priced) would otherwise look identically "unpriced" to a
  // genuinely upcoming one, both to this candidate list and to
  // features/conflicts/api.ts's low-confidence-match picker downstream.
  // It was the actual root cause of 24 open low_confidence_odds_match
  // conflicts live, 2026-09-13: Jimenez vs. Vera (cancelled, visa issue)
  // stayed the sole unmatched candidate on its card, so every later odds
  // event "matched" it at single-digit confidence.
  //
  // M1: paged with selectAllPages, combined with M2's filter above --
  // a plain `.select()` silently truncates at PostgREST's row cap, and
  // `fights` (1,044 rows live, 2026-09-13) had already crossed it.
  const fights = await selectAllPages<EmbeddedFight>(
    supabase,
    "fights",
    "id, fighter1:fighter1_id(name), fighter2:fighter2_id(name), event:event_id(event_date, starts_at)",
    (q) => q.is("settled_at", null),
  );

  return fights
    .filter((f) => !pricedIds.has(f.id))
    .map((f) => ({
      id: f.id,
      eventDate: f.event.event_date,
      fighter1Name: f.fighter1.name,
      fighter2Name: f.fighter2.name,
      startsAt: f.event.starts_at,
    }));
}

/**
 * fetchUnpricedFights, filtered to fights past their card's T-12h window
 * -- the candidate set matchAndSnapshot.ts writes against. See
 * snapshotWindow.ts for why this gate exists.
 */
export async function fetchEligibleUnpricedFights(
  supabase: SupabaseClient,
  now: Date,
): Promise<FightForMatching[]> {
  const fights = await fetchUnpricedFights(supabase);
  return fights.filter((f) => isPastSnapshotWindow(f.startsAt, now));
}
