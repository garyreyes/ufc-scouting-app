import type { SupabaseClient } from "@supabase/supabase-js";
import { stripNullish } from "./stripNullish";
import { namesMatchExactly } from "../text/namesMatchExactly";

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
// Fields that are null/undefined on `fighter` are dropped before any
// update, so a sparse write (Wikipedia has no measurements at all; even
// API-Sports is null for some fighters) never blanks out better data the
// other source already wrote.
export async function upsertFighter(
  supabase: SupabaseClient,
  fighter: FighterWrite,
): Promise<string> {
  const updatePayload = stripNullish(fighter);

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
        .update(updatePayload)
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
      .update(updatePayload)
      .eq("id", byName.id);
    if (updateError) throw updateError;
    return byName.id;
  }

  // The plain exact match above missed a real duplicate live in
  // production (I2b, 2026-09-03): Wikipedia's "André Lima" and
  // API-Sports' "Andre Lima" are the same person, but `ilike` alone is
  // diacritic-sensitive, so each source kept its own separate row.
  // Fetching every name and comparing with namesMatchExactly (fold
  // diacritics, then require an EXACT match -- never fuzzy) is the same
  // "fetch broadly, decide in tested code" pattern this codebase already
  // uses elsewhere, and cheap at this table's size; only paid on the
  // (rare) path where a plain exact match found nothing.
  const { data: allFighters, error: allError } = await supabase.from("fighters").select("id, name");
  if (allError) throw allError;
  const foldedMatch = (allFighters ?? []).find((f) => namesMatchExactly(f.name as string, fighter.name));
  if (foldedMatch) {
    const { error: updateError } = await supabase
      .from("fighters")
      .update(updatePayload)
      .eq("id", foldedMatch.id);
    if (updateError) throw updateError;
    return foldedMatch.id;
  }

  const { data: inserted, error: insertError } = await supabase
    .from("fighters")
    .insert(fighter)
    .select("id")
    .single();
  if (insertError) throw insertError;
  return inserted.id;
}
