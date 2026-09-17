import type { SupabaseClient } from "@supabase/supabase-js";
import { sharesExactlyOneFighter } from "./sharesExactlyOneFighter";
import { stripNullish } from "./stripNullish";
import { buildSourceReportUpdate } from "./buildSourceReportUpdate";
import type { ExistingSourceReports } from "./buildSourceReportUpdate";

export interface FightWrite {
  external_id: string;
  event_id: string;
  fighter1_id: string;
  fighter2_id: string;
  // Which sync job is reporting -- routes winner_id/method/round into the
  // matching per-source columns (buildSourceReportUpdate.ts) instead of
  // the shared winner_id/method/round, which are authoritative and
  // written only by lib/settlement/'s settle job from
  // 0021_result_settlement.sql forward. See ARCHITECTURE.md Fork 6.
  source: "wikipedia" | "api_sports";
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
//
// M2: the conflict branch now also carries `fightId` -- the DISPUTED
// fight's own id, i.e. the existing row the incoming bout collided with --
// alongside the conflict row's id. processScheduleEvent's cancellation
// reconciliation needs this: a fight under an open dispute must always
// count as "present" on the page (it plainly is -- the sources merely
// disagree about who it's against), never be mistaken for a bout that
// vanished from the card.
export type UpsertFightResult =
  | { status: "upserted"; fightId: string }
  | { status: "conflict"; conflictId: string; fightId: string };

function sourceReport(fight: FightWrite, existing: ExistingSourceReports, now: string) {
  return buildSourceReportUpdate(
    {
      source: fight.source,
      winnerId: fight.winner_id ?? null,
      method: fight.method ?? null,
      round: fight.round ?? null,
    },
    existing,
    now,
  );
}

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
  const { external_id, event_id, fighter1_id, fighter2_id, weight_class, bout_order } = fight;
  const directPayload = stripNullish({ weight_class, bout_order });
  const now = new Date().toISOString();

  const { data: byExternalId, error: findError } = await supabase
    .from("fights")
    .select("id, wikipedia_reported_at, api_sports_reported_at")
    .eq("external_id", external_id)
    .maybeSingle();
  if (findError) throw findError;

  if (byExternalId) {
    const updatePayload = {
      ...directPayload,
      ...sourceReport(
        fight,
        { wikipediaReportedAt: byExternalId.wikipedia_reported_at, apiSportsReportedAt: byExternalId.api_sports_reported_at },
        now,
      ),
    };
    const { error } = await supabase.from("fights").update(updatePayload).eq("id", byExternalId.id);
    if (error) throw error;
    return { status: "upserted", fightId: byExternalId.id };
  }

  const { data: candidates, error: candidatesError } = await supabase
    .from("fights")
    .select("id, fighter1_id, fighter2_id, wikipedia_reported_at, api_sports_reported_at")
    .eq("event_id", event_id);
  if (candidatesError) throw candidatesError;

  const match = candidates?.find(
    (c) =>
      (c.fighter1_id === fighter1_id && c.fighter2_id === fighter2_id) ||
      (c.fighter1_id === fighter2_id && c.fighter2_id === fighter1_id),
  );
  if (match) {
    const updatePayload = {
      ...directPayload,
      // Adopt the incoming external_id when a row is found by fighter
      // pair rather than by id. This is what migrates rows still
      // carrying the old position-based wiki key
      // (buildWikiFightExternalId.ts) onto the stable one: the pair
      // fallback finds them once, and from then on they resolve by id
      // again. Safe against the unique constraint because a pair is
      // unique within an event -- the fallback above just proved no
      // other row holds this pairing.
      external_id,
      ...sourceReport(
        fight,
        { wikipediaReportedAt: match.wikipedia_reported_at, apiSportsReportedAt: match.api_sports_reported_at },
        now,
      ),
    };
    const { error } = await supabase.from("fights").update(updatePayload).eq("id", match.id);
    if (error) throw error;
    return { status: "upserted", fightId: match.id };
  }

  const disputed = candidates?.find((c) => sharesExactlyOneFighter(c, { fighter1_id, fighter2_id }));
  if (disputed) {
    // M3: the owner may have already told us, permanently, "no -- keep
    // the existing fighter, ignore this source's candidate" for this
    // EXACT candidate (resolveDisputedOpponent.ts's "existing" choice,
    // resolution "confirmed_existing"). Without this check, that answer
    // was never actually remembered: the next sync sees the identical
    // candidate pairing again and reopens the same dispute from scratch,
    // forever -- found live, twice, 2026-09-13 (Delgado and King/Rosas).
    // Checked against every RESOLVED conflict on this fight, not just the
    // open one below, and matched in JS against the stored
    // candidate_external_id -- same "fetch broadly, decide in tested
    // code" pattern the rest of this codebase already uses for name
    // matching. A DIFFERENT candidate, or a past resolution that actually
    // changed the row (used_candidate), must still open normally.
    const { data: resolvedConflicts, error: resolvedError } = await supabase
      .from("data_conflicts")
      .select("resolution, details")
      .eq("kind", "disputed_opponent")
      .eq("fight_id", disputed.id)
      .not("resolved_at", "is", null);
    if (resolvedError) throw resolvedError;
    const keptCurrent = (resolvedConflicts ?? []).some(
      (c) =>
        c.resolution === "confirmed_existing" &&
        (c.details as { candidate_external_id?: string } | null)?.candidate_external_id === external_id,
    );
    if (keptCurrent) {
      const updatePayload = {
        ...directPayload,
        ...sourceReport(
          fight,
          { wikipediaReportedAt: disputed.wikipedia_reported_at, apiSportsReportedAt: disputed.api_sports_reported_at },
          now,
        ),
      };
      const { error } = await supabase.from("fights").update(updatePayload).eq("id", disputed.id);
      if (error) throw error;
      return { status: "upserted", fightId: disputed.id };
    }

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
      return { status: "conflict", conflictId: existingConflict.id, fightId: disputed.id };
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
          winner_id: fight.winner_id ?? null,
          method: fight.method ?? null,
          round: fight.round ?? null,
          weight_class: fight.weight_class ?? null,
          bout_order: fight.bout_order ?? null,
        },
      })
      .select("id")
      .single();
    if (conflictError) throw conflictError;
    return { status: "conflict", conflictId: conflict.id, fightId: disputed.id };
  }

  const insertPayload = {
    external_id,
    event_id,
    fighter1_id,
    fighter2_id,
    ...directPayload,
    ...sourceReport(fight, { wikipediaReportedAt: null, apiSportsReportedAt: null }, now),
  };
  const { data: inserted, error: insertError } = await supabase
    .from("fights")
    .insert(insertPayload)
    .select("id")
    .single();
  if (insertError) throw insertError;
  return { status: "upserted", fightId: inserted.id };
}
