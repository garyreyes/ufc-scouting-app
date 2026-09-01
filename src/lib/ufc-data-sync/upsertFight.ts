import type { SupabaseClient } from "@supabase/supabase-js";
import { stripNullish } from "./stripNullish";

export interface FightWrite {
  external_id: string;
  event_id: string;
  fighter1_id: string;
  fighter2_id: string;
  winner_id?: string | null;
  method?: string | null;
  round?: number | null;
  weight_class?: string | null;
  // Only ever known from the Wikipedia sync (API-Sports has no concept of
  // card position) -- see syncSchedule.ts. 0 is a valid value (the main
  // event), so this relies on stripNullish only filtering actual
  // null/undefined, not falsy values -- already covered by
  // stripNullish.test.ts's "keeps falsy values that carry meaning" case.
  bout_order?: number | null;
}

// Same cross-source problem as upsertFighter/upsertEvent: API-Sports and
// Wikipedia describe the same bout under different external_ids ("2853"
// vs "wiki:UFC Fight Night: ...:9"). Falls back to matching on (event,
// unordered fighter pair) so re-running either sync job merges into one
// row instead of leaving one fight as two.
export async function upsertFight(
  supabase: SupabaseClient,
  fight: FightWrite,
): Promise<string> {
  const { external_id, event_id, fighter1_id, fighter2_id, ...optional } = fight;
  const updatePayload = stripNullish(optional);

  const { data: byExternalId, error: findError } = await supabase
    .from("fights")
    .select("id")
    .eq("external_id", external_id)
    .maybeSingle();
  if (findError) throw findError;

  if (byExternalId) {
    const { error } = await supabase.from("fights").update(updatePayload).eq("id", byExternalId.id);
    if (error) throw error;
    return byExternalId.id;
  }

  const { data: candidates, error: candidatesError } = await supabase
    .from("fights")
    .select("id, fighter1_id, fighter2_id")
    .eq("event_id", event_id);
  if (candidatesError) throw candidatesError;

  const match = candidates?.find(
    (c) =>
      (c.fighter1_id === fighter1_id && c.fighter2_id === fighter2_id) ||
      (c.fighter1_id === fighter2_id && c.fighter2_id === fighter1_id),
  );
  if (match) {
    const { error } = await supabase.from("fights").update(updatePayload).eq("id", match.id);
    if (error) throw error;
    return match.id;
  }

  const { data: inserted, error: insertError } = await supabase
    .from("fights")
    .insert(fight)
    .select("id")
    .single();
  if (insertError) throw insertError;
  return inserted.id;
}
