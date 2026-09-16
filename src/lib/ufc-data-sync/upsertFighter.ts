import type { SupabaseClient } from "@supabase/supabase-js";
import { stripNullish } from "./stripNullish";
import { namesLikelySamePerson } from "../text/namesLikelySamePerson";
import { normalizeName } from "../text/normalizeName";

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

  // M3: a fighter name that was merged away lives on here (0044's
  // merge_fighters() writes one row per drop, source 'merge'). Checked
  // after external_id and before the plain name match so a since-renamed
  // source ("Jose Delgado", now merged into "Jose Miguel Delgado")
  // resolves straight to the keeper instead of recreating the duplicate
  // it was merged to fix -- which is exactly what would reopen the
  // disputed_opponent conflict this was built to stop recurring.
  //
  // Fetched broadly and matched in JS (normalizeName), same pattern as
  // the fold-match branch below: this table is small, and every real
  // "same name" rule in this codebase already lives in TypeScript, not
  // SQL (see 0044's own migration comment on why).
  const { data: aliases, error: aliasError } = await supabase.from("fighter_aliases").select("alias, fighter_id");
  if (aliasError) throw aliasError;
  const aliasMatch = (aliases ?? []).find((a) => normalizeName(a.alias as string) === normalizeName(fighter.name));
  if (aliasMatch) {
    // Never write `name` here -- the incoming name is, by definition, the
    // dropped alias, not the keeper's canonical one. Writing it would
    // flip-flop the keeper's display name between the two every time the
    // still-reporting source syncs (reviewer finding).
    const aliasUpdatePayload = { ...updatePayload };
    delete aliasUpdatePayload.name;
    const { error: updateError } = await supabase
      .from("fighters")
      .update(aliasUpdatePayload)
      .eq("id", aliasMatch.fighter_id);
    if (updateError) throw updateError;
    return aliasMatch.fighter_id as string;
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
    // this check, or two API-Sports rows that only started folding
    // together once namesLikelySamePerson widened), update the one
    // carrying an external_id -- that is the identity row API-Sports'
    // results sync and Sherdog both key on. Fully deterministic, not
    // just "prefer external_id": ties within either group break on `id`,
    // since PostgREST makes no row-order guarantee on a plain select and
    // picking arbitrarily would let two rows keep ping-ponging which one
    // gets each write (reviewer finding, L2b).
    const withExternalId = foldedMatches
      .filter((f) => f.external_id !== null && f.external_id !== undefined)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const target =
      withExternalId[0] ??
      [...foldedMatches].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
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
