import type { SupabaseClient } from "@supabase/supabase-js";
import { stripNullish } from "./stripNullish";
import { namesLikelySamePerson } from "../text/namesLikelySamePerson";
import { pickCanonicalFighter } from "./pickCanonicalFighter";
import { selectAllPages } from "../supabase/selectAllPages";

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

  // M1: was `.maybeSingle()`, which THROWS on more than one row instead of
  // resolving it -- and a case-insensitive collision is a real, live shape
  // ("Jose Delgado" / "Jose Miguel Delgado" both stored, differing only in
  // case-insensitive prefix match never actually applies here, but two
  // genuinely identical-modulo-case names has happened). A plain select +
  // pickCanonicalFighter resolves it the same deterministic way the
  // fold-match branch below always has.
  const { data: byNameRows, error: nameError } = await supabase
    .from("fighters")
    .select("id, external_id")
    .ilike("name", fighter.name);
  if (nameError) throw nameError;
  if (byNameRows && byNameRows.length > 0) {
    const target = pickCanonicalFighter(byNameRows);
    const { error: updateError } = await supabase
      .from("fighters")
      .update(updatePayload)
      .eq("id", target.id);
    if (updateError) throw updateError;
    return target.id;
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
  //
  // M1: paged with selectAllPages -- a plain `.select()` silently
  // truncates at PostgREST's row cap (1,000), and `fighters` (822 rows
  // live, 2026-09-13) is one growth cycle from crossing it, at which point
  // this scan would start missing rows past the cap and inserting
  // duplicates instead of finding the real match.
  const allFighters = await selectAllPages<{ id: string; name: string; external_id: string | null }>(
    supabase,
    "fighters",
    "id, name, external_id",
  );
  const foldedMatches = allFighters.filter((f) => namesLikelySamePerson(f.name, fighter.name));
  if (foldedMatches.length > 0) {
    // When several rows fold to the same name (a duplicate that predates
    // this check, or two API-Sports rows that only started folding
    // together once namesLikelySamePerson widened), update the one
    // carrying an external_id -- see pickCanonicalFighter's own comment
    // for why, and for the id tie-break within either group.
    const target = pickCanonicalFighter(foldedMatches);
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
