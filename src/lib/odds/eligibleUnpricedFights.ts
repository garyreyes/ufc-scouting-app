import type { SupabaseClient } from "@supabase/supabase-js";
import { isPastSnapshotWindow } from "./snapshotWindow";
import type { FightForMatching } from "./types";

/**
 * Fights that are both unpriced (no odds_snapshots row) and past their
 * card's T-12h window -- i.e. fights a snapshot run should have already
 * priced. Two consumers: matchAndSnapshot.ts uses it as its candidate set
 * to write against; features/job-health/api.ts uses its count as the
 * "missed snapshot" signal for the banner, since a fight can sit here
 * indefinitely even while the job itself keeps succeeding (e.g. the odds
 * feed simply never lists it -- `decideMatch`'s `no_candidates` case).
 *
 * Works with either the service-role admin client or the public anon
 * client -- fights, events, and odds_snapshots are all public-read
 * (0002_grants.sql, 0013_odds_snapshots.sql), so the banner's client-side
 * read doesn't need elevated privileges.
 */
export async function fetchEligibleUnpricedFights(
  supabase: SupabaseClient,
  now: Date,
): Promise<FightForMatching[]> {
  const { data: alreadyPriced, error: pricedError } = await supabase
    .from("odds_snapshots")
    .select("fight_id");
  if (pricedError) throw pricedError;
  const pricedIds = new Set((alreadyPriced ?? []).map((row) => row.fight_id as string));

  // Same PostgREST FK-embed pattern as features/fights/api.ts. starts_at
  // comes along so the T-12h gate below can be applied without a second
  // round trip per fight.
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
    .filter((f) => isPastSnapshotWindow(f.event.starts_at, now))
    .map((f) => ({
      id: f.id,
      eventDate: f.event.event_date,
      fighter1Name: f.fighter1.name,
      fighter2Name: f.fighter2.name,
    }));
}
