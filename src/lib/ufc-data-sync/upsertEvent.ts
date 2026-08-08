import type { SupabaseClient } from "@supabase/supabase-js";

export interface EventWrite {
  external_id: string;
  name: string;
  event_date: string;
}

// Same two-source problem as upsertFighter.ts: API-Sports and Wikipedia
// name the same event slightly differently ("UFC Fight Night: X vs Y" vs
// "UFC Fight Night: X vs. Y") so external_id alone doesn't catch the
// overlap. Falls back to a punctuation/case-insensitive name match.
function normalizeEventName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export async function upsertEvent(
  supabase: SupabaseClient,
  event: EventWrite,
): Promise<string> {
  const { data: byExternalId, error: findError } = await supabase
    .from("events")
    .select("id")
    .eq("external_id", event.external_id)
    .maybeSingle();
  if (findError) throw findError;

  if (byExternalId) {
    const { error } = await supabase
      .from("events")
      .update({ name: event.name, event_date: event.event_date })
      .eq("id", byExternalId.id);
    if (error) throw error;
    return byExternalId.id;
  }

  const normalizedTarget = normalizeEventName(event.name);
  const { data: candidates, error: candidatesError } = await supabase
    .from("events")
    .select("id, name, external_id")
    .eq("event_date", event.event_date);
  if (candidatesError) throw candidatesError;

  const match = candidates?.find((c) => normalizeEventName(c.name) === normalizedTarget);
  if (match) {
    // Leave name/external_id untouched -- whichever source created this
    // row first "wins" the display name, so re-running either sync job
    // doesn't make it flip-flop between "vs" and "vs." on every run.
    return match.id;
  }

  const { data: inserted, error: insertError } = await supabase
    .from("events")
    .insert(event)
    .select("id")
    .single();
  if (insertError) throw insertError;
  return inserted.id;
}
