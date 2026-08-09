import { supabase } from "@/lib/db";
import { isInvalidIdError } from "@/lib/isInvalidIdError";
import type { EventSummary, EventWithFights, FightDetail } from "./types";

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

export async function getEventWithFights(
  eventId: string,
  weightClasses: string[] = [],
): Promise<EventWithFights | null> {
  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id, name, event_date")
    .eq("id", eventId)
    .maybeSingle();
  if (eventError) {
    if (isInvalidIdError(eventError)) return null;
    throw eventError;
  }
  if (!event) return null;

  let query = supabase
    .from("fights")
    .select(
      "id, weight_class, method, round, winner_id, fighter1:fighter1_id(id, name), fighter2:fighter2_id(id, name)",
    )
    .eq("event_id", eventId);
  if (weightClasses.length > 0) {
    query = query.in("weight_class", weightClasses);
  }

  const { data: fights, error: fightsError } = await query;
  if (fightsError) throw fightsError;

  return { ...event, fights: fights as unknown as EventWithFights["fights"] };
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
