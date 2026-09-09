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

// A row that mergeDuplicateSameDateEvents.ts (K1) folded into another
// carries `merged_into`. A source still reporting the old external_id
// must resolve to the survivor, not resurrect the duplicate -- follow the
// pointer (one hop in practice; capped defensively against a cycle).
async function resolveMergedInto(supabase: SupabaseClient, id: string): Promise<string> {
  let current = id;
  for (let hop = 0; hop < 5; hop++) {
    const { data, error } = await supabase
      .from("events")
      .select("merged_into")
      .eq("id", current)
      .maybeSingle();
    if (error) throw error;
    const next = data?.merged_into as string | null | undefined;
    if (!next || next === current) return current;
    current = next;
  }
  return current;
}

export async function upsertEvent(
  supabase: SupabaseClient,
  event: EventWrite,
): Promise<string> {
  const { data: byExternalId, error: findError } = await supabase
    .from("events")
    .select("id, merged_into")
    .eq("external_id", event.external_id)
    .maybeSingle();
  if (findError) throw findError;

  if (byExternalId) {
    if (byExternalId.merged_into) {
      // Don't touch the folded row's name/date -- the survivor owns them.
      return resolveMergedInto(supabase, byExternalId.merged_into as string);
    }
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
    .eq("event_date", event.event_date)
    .is("merged_into", null);
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
