import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The id of the single soonest event that hasn't happened yet -- "the
 * card the app is currently about," in the PRD's own framing (UC-1: "before
 * a card, I open an event"). One definition, shared by every job whose
 * useful scope is that one card rather than the whole future schedule:
 * the rumour scan (Gemini free-tier budget) and, since Phase L1, the
 * intern's own pick generation.
 *
 * "Upcoming" is `event_date >= today` (UTC date, no time component --
 * `events.event_date` is a plain date). A card that started earlier today
 * still counts as current until the date rolls over; that's cosmetic,
 * since picks lock at `starts_at` regardless and the intern revises only
 * until then.
 *
 * `merged_into is null` excludes the loser side of a K1/K2 duplicate-event
 * merge -- those rows are tombstones pointing at the real event.
 *
 * Returns null when there is no upcoming card at all (the "no card this
 * week" empty state, docs/PRD.md).
 */
export async function fetchNearestUpcomingEventId(
  supabase: SupabaseClient,
): Promise<string | null> {
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("events")
    .select("id")
    .gte("event_date", today)
    .is("merged_into", null)
    .order("event_date", { ascending: true })
    .limit(1);
  if (error) throw error;

  return (data?.[0]?.id as string | undefined) ?? null;
}
