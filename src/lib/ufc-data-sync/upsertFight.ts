import type { SupabaseClient } from "@supabase/supabase-js";
import { sharesExactlyOneFighter } from "./sharesExactlyOneFighter";
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

// A disputed opponent never produces a new fight row -- see the "conflict"
// branch below -- so callers can no longer assume a fight id always comes
// back. Neither current caller (syncJob.ts, syncSchedule.ts) uses the
// return value, so this is a safe shape change.
export type UpsertFightResult =
  | { status: "upserted"; fightId: string }
  | { status: "conflict"; conflictId: string };

// Same cross-source problem as upsertFighter/upsertEvent: API-Sports and
// Wikipedia describe the same bout under different external_ids ("2853"
// vs "wiki:UFC Fight Night: ...:9"). Falls back to matching on (event,
// unordered fighter pair) so re-running either sync job merges into one
// row instead of leaving one fight as two.
//
// ARCHITECTURE.md Fork 5 (CHANGES.md Phase 7): the two sources sometimes
// report a different opponent for the same fighter -- not a new bout, one
// bout the sources disagree about. Before falling through to INSERT (which
// is where the duplicate rows used to get created), a candidate sharing
// exactly one fighter with the incoming fight opens a data_conflicts row
// instead. Never auto-merge on a guess -- see sharesExactlyOneFighter.ts
// for the actual detection rule and its tests.
export async function upsertFight(
  supabase: SupabaseClient,
  fight: FightWrite,
): Promise<UpsertFightResult> {
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
    return { status: "upserted", fightId: byExternalId.id };
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
    return { status: "upserted", fightId: match.id };
  }

  const disputed = candidates?.find((c) => sharesExactlyOneFighter(c, { fighter1_id, fighter2_id }));
  if (disputed) {
    // The sync runs twice daily and a genuine dispute can persist across
    // several runs before it self-resolves (convergence or a confirmed
    // result -- Fork 5). Without this check, every run would open a new
    // row for the same ongoing dispute, defeating "one place to check."
    const { data: existingConflict, error: existingError } = await supabase
      .from("data_conflicts")
      .select("id")
      .eq("kind", "disputed_opponent")
      .eq("fight_id", disputed.id)
      .is("resolved_at", null)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existingConflict) {
      return { status: "conflict", conflictId: existingConflict.id };
    }

    const { data: conflict, error: conflictError } = await supabase
      .from("data_conflicts")
      .insert({
        kind: "disputed_opponent",
        fight_id: disputed.id,
        details: {
          candidate_external_id: external_id,
          candidate_fighter1_id: fighter1_id,
          candidate_fighter2_id: fighter2_id,
          ...optional,
        },
      })
      .select("id")
      .single();
    if (conflictError) throw conflictError;
    return { status: "conflict", conflictId: conflict.id };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("fights")
    .insert(fight)
    .select("id")
    .single();
  if (insertError) throw insertError;
  return { status: "upserted", fightId: inserted.id };
}
