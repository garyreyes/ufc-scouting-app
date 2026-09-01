import type { SupabaseClient } from "@supabase/supabase-js";
import { isPastSnapshotWindow } from "./snapshotWindow";
import type { FightForMatching } from "./types";

export interface UnpricedFight extends FightForMatching {
  startsAt: string | null;
}

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
 * Works with either the service-role admin client or the public anon
 * client -- fights, events, and odds_snapshots are all public-read
 * (0002_grants.sql, 0013_odds_snapshots.sql).
 */
export async function fetchUnpricedFights(supabase: SupabaseClient): Promise<UnpricedFight[]> {
  const { data: alreadyPriced, error: pricedError } = await supabase
    .from("odds_snapshots")
    .select("fight_id");
  if (pricedError) throw pricedError;
  const pricedIds = new Set((alreadyPriced ?? []).map((row) => row.fight_id as string));

  // Same PostgREST FK-embed pattern as features/fights/api.ts.
  const { data: fights, error: fightsError } = await supabase
    .from("fights")
    .select(
      "id, fighter1:fighter1_id(name), fighter2:fighter2_id(name), event:event_id(event_date, starts_at)",
    );
  if (fightsError) throw fightsError;

  type EmbeddedFight = {
    id: string;
    fighter1: { name: string };
    fighter2: { name: string };
    event: { event_date: string; starts_at: string | null };
  };

  return ((fights ?? []) as unknown as EmbeddedFight[])
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
