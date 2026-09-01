import { supabase } from "@/lib/db";
import { isInvalidIdError } from "@/lib/isInvalidIdError";
import type { CardBout, CardView, EventSummary, FightDetail } from "./types";

const today = () => new Date().toISOString().slice(0, 10);

export async function getUpcomingEvents(): Promise<EventSummary[]> {
  const { data, error } = await supabase
    .from("events")
    .select("id, name, event_date")
    .gte("event_date", today())
    .order("event_date", { ascending: true });
  if (error) throw error;
  return data;
}

export async function getPastEvents(): Promise<EventSummary[]> {
  const { data, error } = await supabase
    .from("events")
    .select("id, name, event_date")
    .lt("event_date", today())
    .order("event_date", { ascending: false });
  if (error) throw error;
  return data;
}

/**
 * The card view's own query (C3): fights in bout_order (Wikipedia's
 * main-card-first array index -- 0 is the main event, ascending toward
 * prelims; nulls -- API-Sports-only fights with no Wikipedia bout_order
 * yet -- sort last rather than guessing a position), each with its odds
 * if priced. odds_snapshots is fetched separately and merged by fight_id
 * rather than embedded via the reverse FK, matching the established
 * pattern in matchAndSnapshot.ts's own fetchEligibleUnpricedFights --
 * sidesteps any ambiguity in how PostgREST shapes a one-to-one reverse
 * embed. Both fights and odds_snapshots are public-read, so this is safe
 * to call for a logged-out visitor too (the picks layer on top is a
 * separate, owner-gated fetch -- features/picks/api.ts).
 */
export async function getCardView(
  eventId: string,
  weightClasses: string[] = [],
): Promise<CardView | null> {
  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id, name, event_date, starts_at")
    .eq("id", eventId)
    .maybeSingle();
  if (eventError) {
    if (isInvalidIdError(eventError)) return null;
    throw eventError;
  }
  if (!event) return null;

  let fightsQuery = supabase
    .from("fights")
    .select(
      "id, bout_order, weight_class, method, round, winner_id, fighter1:fighter1_id(id, name), fighter2:fighter2_id(id, name)",
    )
    .eq("event_id", eventId);
  if (weightClasses.length > 0) {
    fightsQuery = fightsQuery.in("weight_class", weightClasses);
  }
  const { data: fights, error: fightsError } = await fightsQuery.order("bout_order", {
    ascending: true,
    nullsFirst: false,
  });
  if (fightsError) throw fightsError;

  const fightIds = (fights ?? []).map((f) => f.id);
  const { data: oddsRows, error: oddsError } =
    fightIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("odds_snapshots")
          .select("fight_id, fighter1_price, fighter2_price")
          .in("fight_id", fightIds);
  if (oddsError) throw oddsError;
  const oddsByFightId = new Map(
    (oddsRows ?? []).map((o) => [
      o.fight_id as string,
      { fighter1_price: o.fighter1_price as number, fighter2_price: o.fighter2_price as number },
    ]),
  );

  const bouts: CardBout[] = ((fights ?? []) as unknown as Omit<CardBout, "odds">[]).map((f) => ({
    ...f,
    odds: oddsByFightId.get(f.id) ?? null,
  }));

  return { ...event, fights: bouts };
}

export async function getFightById(fightId: string): Promise<FightDetail | null> {
  const { data, error } = await supabase
    .from("fights")
    .select(
      "id, weight_class, method, round, winner_id, fighter1:fighter1_id(id, name), fighter2:fighter2_id(id, name), event:event_id(id, name, event_date)",
    )
    .eq("id", fightId)
    .maybeSingle();
  if (error) {
    if (isInvalidIdError(error)) return null;
    throw error;
  }
  if (!data) return null;

  return data as unknown as FightDetail;
}
