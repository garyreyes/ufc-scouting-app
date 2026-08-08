import type { SupabaseClient } from "@supabase/supabase-js";

export interface FighterWrite {
  name: string;
  external_id?: string;
  height_cm?: number | null;
  reach_cm?: number | null;
  weight_class?: string | null;
  stance?: string | null;
  synced_at?: string;
}

// Fighters can arrive from two sources: API-Sports (has a stable
// external_id) or Wikipedia's schedule pages (name only, no external_id
// yet, since the fighter's card hasn't reached API-Sports' reachable
// window). Matching by external_id first, falling back to an exact
// case-insensitive name match, means a Wikipedia-created placeholder row
// gets updated in place once real data arrives instead of duplicated.
// Fields not present on `fighter` are left untouched on update, so a
// sparse Wikipedia-only write never blanks out fuller API-Sports data.
export async function upsertFighter(
  supabase: SupabaseClient,
  fighter: FighterWrite,
): Promise<string> {
  if (fighter.external_id) {
    const { data: byExternalId, error } = await supabase
      .from("fighters")
      .select("id")
      .eq("external_id", fighter.external_id)
      .maybeSingle();
    if (error) throw error;
    if (byExternalId) {
      const { error: updateError } = await supabase
        .from("fighters")
        .update(fighter)
        .eq("id", byExternalId.id);
      if (updateError) throw updateError;
      return byExternalId.id;
    }
  }

  const { data: byName, error: nameError } = await supabase
    .from("fighters")
    .select("id")
    .ilike("name", fighter.name)
    .maybeSingle();
  if (nameError) throw nameError;
  if (byName) {
    const { error: updateError } = await supabase
      .from("fighters")
      .update(fighter)
      .eq("id", byName.id);
    if (updateError) throw updateError;
    return byName.id;
  }

  const { data: inserted, error: insertError } = await supabase
    .from("fighters")
    .insert(fighter)
    .select("id")
    .single();
  if (insertError) throw insertError;
  return inserted.id;
}
