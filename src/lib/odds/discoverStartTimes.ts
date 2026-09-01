import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchMmaOdds } from "./client";
import { AUTO_MATCH_THRESHOLD, scoreOddsEventMatch } from "./matchFights";
import type { FightForMatching, OddsEvent } from "./types";

/**
 * The card's `starts_at` is the earliest fight's `commence_time` among its
 * CONFIDENTLY matched fights (the same `AUTO_MATCH_THRESHOLD` B3 uses for
 * pricing, since a wrong start time undermines the pick lock the same way
 * a wrong price undermines the units board -- both are things C1 depends
 * on being right, not just close). Fights with no confident match are
 * silently excluded, not guessed: the pick lock is stricter than the
 * per-fight rule already (ARCHITECTURE.md), so under-covering by one
 * unmatched prelim just means locking hasn't tightened onto that bout yet
 * -- it never means locking too early or accepting a wrong time.
 *
 * Returns null if no fight on the card has a confident match yet -- there
 * is nothing to update the card to.
 */
export function earliestConfirmedStartTime(
  fights: FightForMatching[],
  oddsEvents: OddsEvent[],
): string | null {
  let earliest: string | null = null;

  for (const fight of fights) {
    const match = scoreOddsEventMatch(fight, oddsEvents);
    if (!match || match.confidence < AUTO_MATCH_THRESHOLD) continue;

    const commenceTime = match.oddsEvent.commence_time;
    if (!earliest || new Date(commenceTime).getTime() < new Date(earliest).getTime()) {
      earliest = commenceTime;
    }
  }

  return earliest;
}

export interface DiscoverStartTimesSummary {
  updated: number;
  noConfidentMatch: number;
}

/**
 * One pass: for every upcoming event without a settled result, find the
 * earliest confidently-matched fight's commence_time and write it to
 * events.starts_at. Deliberately overwrites rather than only filling
 * nulls -- the PRD's "card postponed -> picks carry to the new date,
 * locks recompute" needs starts_at to track the latest odds data, not
 * freeze on first discovery. This is what makes the odds feed the source
 * of truth for the pick lock; see B4 in ROADMAP.md.
 *
 * Does not decide WHEN to run -- that's B5's cron alongside the T-12h
 * snapshot job.
 */
export async function discoverStartTimes(
  supabase: SupabaseClient,
): Promise<DiscoverStartTimesSummary> {
  const summary: DiscoverStartTimesSummary = { updated: 0, noConfidentMatch: 0 };

  const today = new Date().toISOString().slice(0, 10);
  const { data: events, error: eventsError } = await supabase
    .from("events")
    .select("id, event_date")
    .gte("event_date", today);
  if (eventsError) throw eventsError;
  if (!events || events.length === 0) return summary;

  const oddsEvents = await fetchMmaOdds();

  for (const event of events) {
    const { data: fights, error: fightsError } = await supabase
      .from("fights")
      .select("id, fighter1:fighter1_id(name), fighter2:fighter2_id(name)")
      .eq("event_id", event.id);
    if (fightsError) throw fightsError;

    type EmbeddedFight = { id: string; fighter1: { name: string }; fighter2: { name: string } };
    const fightsForMatching: FightForMatching[] = ((fights ?? []) as unknown as EmbeddedFight[]).map(
      (f) => ({
        id: f.id,
        eventDate: event.event_date,
        fighter1Name: f.fighter1.name,
        fighter2Name: f.fighter2.name,
      }),
    );

    const startsAt = earliestConfirmedStartTime(fightsForMatching, oddsEvents);
    if (!startsAt) {
      summary.noConfidentMatch++;
      continue;
    }

    const { error: updateError } = await supabase
      .from("events")
      .update({ starts_at: startsAt })
      .eq("id", event.id);
    if (updateError) throw updateError;
    summary.updated++;
  }

  return summary;
}
