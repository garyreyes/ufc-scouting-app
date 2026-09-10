import type { SupabaseClient } from "@supabase/supabase-js";
import { stripNullish } from "./stripNullish";
import { namesLikelySamePerson } from "../text/namesLikelySamePerson";

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

  // The plain exact match above missed real duplicates live in production:
  // I2b (2026-09-03) -- Wikipedia's "André Lima" vs API-Sports' "Andre
  // Lima", `ilike` being diacritic-sensitive -- and L2b (2026-09-10) --
  // "Sumudaerji" / "Su Mudaerji" (missing space) and "Ce Liu" / "Liu Ce"
  // (family-name-first romanisation), which fold identically once space
  // and token order are ignored. `namesLikelySamePerson` covers all three
  // structural rewrites and nothing looser (never a nickname). Same
  // "fetch broadly, decide in tested code" pattern used elsewhere here,
  // cheap at this table's size, only paid when a plain exact match found
  // nothing.
  const { data: allFighters, error: allError } = await supabase
    .from("fighters")
    .select("id, name, external_id");
  if (allError) throw allError;
  const foldedMatches = (allFighters ?? []).filter((f) =>
    namesLikelySamePerson(f.name as string, fighter.name),
  );
  if (foldedMatches.length > 0) {
    // When several rows fold to the same name (a duplicate that predates
    // this check), update the one carrying an external_id -- that is the
    // identity row API-Sports' results sync and Sherdog both key on, and
    // picking it deterministically stops the two rows ping-ponging which
    // one each source writes to.
    const target =
      foldedMatches.find((f) => f.external_id !== null && f.external_id !== undefined) ??
      foldedMatches[0];
    const { error: updateError } = await supabase
      .from("fighters")
      .update(updatePayload)
      .eq("id", target.id);
    if (updateError) throw updateError;
    return target.id;
  }

  const { data: inserted, error: insertError } = await supabase
    .from("fighters")
    .insert(fighter)
    .select("id")
    .single();
  if (insertError) throw insertError;
  return inserted.id;
}
