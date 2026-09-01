import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateFightSettlement } from "./evaluateFightSettlement";
import type { FightSourceState } from "./evaluateFightSettlement";

export interface SettleFightsSummary {
  settled: number;
  conflicts: number;
  stillWaiting: number;
}

/**
 * The I/O half of D1 -- evaluateFightSettlement.ts owns the judgment,
 * this owns fetching the current per-source state and writing the
 * result. Scoped to `fights` only: writing `picks.pick_correct`/
 * `pnl_units` off a newly-settled fight is D2's separate job, not this
 * one's (ROADMAP.md Phase D splits "what happened" from "how that gets
 * applied to every pick" on purpose).
 *
 * Queries every not-yet-settled fight rather than pre-filtering to
 * "at least one source reported" server-side -- this app's fight volume
 * is small, and evaluateFightSettlement already correctly returns
 * {action: "wait"} for a genuinely unreported fight, so a second,
 * syntax-risky filter would buy nothing (matches the reasoning in
 * features/picks/api.ts for preferring a simpler query over a
 * PostgREST filter shape that hasn't been verified live).
 *
 * A gap found orienting on D2, fixed here rather than left for later:
 * a fight with an open disputed_opponent conflict must never settle a
 * winner, even if both sources happen to agree on one -- the bout on
 * file may not be the real one (ARCHITECTURE.md Fork 5), and scoring a
 * pick against a bout that never happened corrupts the accuracy line
 * the same way a phantom stake corrupts units. Treated as "wait," not a
 * new conflict -- disputed_opponent is already the queue entry that
 * covers it.
 */
export async function settleFights(supabase: SupabaseClient): Promise<SettleFightsSummary> {
  const now = new Date();

  const { data: fights, error } = await supabase
    .from("fights")
    .select(
      "id, wikipedia_winner_id, wikipedia_method, wikipedia_round, wikipedia_reported_at, api_sports_winner_id, api_sports_reported_at",
    )
    .is("settled_at", null);
  if (error) throw error;

  const { data: openDisputes, error: disputesError } = await supabase
    .from("data_conflicts")
    .select("fight_id")
    .eq("kind", "disputed_opponent")
    .is("resolved_at", null);
  if (disputesError) throw disputesError;
  const disputedFightIds = new Set((openDisputes ?? []).map((row) => row.fight_id as string));

  const summary: SettleFightsSummary = { settled: 0, conflicts: 0, stillWaiting: 0 };

  for (const fight of fights ?? []) {
    if (disputedFightIds.has(fight.id)) {
      summary.stillWaiting++;
      continue;
    }

    const state: FightSourceState = {
      wikipediaWinnerId: fight.wikipedia_winner_id,
      wikipediaMethod: fight.wikipedia_method,
      wikipediaRound: fight.wikipedia_round,
      wikipediaReportedAt: fight.wikipedia_reported_at,
      apiSportsWinnerId: fight.api_sports_winner_id,
      apiSportsReportedAt: fight.api_sports_reported_at,
    };
    const decision = evaluateFightSettlement(state, now);

    if (decision.action === "wait") {
      summary.stillWaiting++;
      continue;
    }

    if (decision.action === "settle") {
      const { error: updateError } = await supabase
        .from("fights")
        .update({
          winner_id: decision.winnerId,
          method: decision.method,
          round: decision.round,
          settled_at: now.toISOString(),
          settled_from: decision.settledFrom,
        })
        .eq("id", fight.id);
      if (updateError) throw updateError;
      summary.settled++;
      continue;
    }

    // action === "conflict" -- same reuse-existing-open-row pattern as
    // upsertFight.ts's disputed_opponent handling, so a fight stuck in
    // disagreement across several twice-daily runs doesn't pile up
    // duplicate queue entries.
    const { data: existingConflict, error: existingError } = await supabase
      .from("data_conflicts")
      .select("id")
      .eq("kind", "disputed_result")
      .eq("fight_id", fight.id)
      .is("resolved_at", null)
      .maybeSingle();
    if (existingError) throw existingError;

    if (!existingConflict) {
      const { error: insertError } = await supabase.from("data_conflicts").insert({
        kind: "disputed_result",
        fight_id: fight.id,
        details: {
          wikipedia_winner_id: fight.wikipedia_winner_id,
          wikipedia_method: fight.wikipedia_method,
          wikipedia_round: fight.wikipedia_round,
          api_sports_winner_id: fight.api_sports_winner_id,
        },
      });
      if (insertError) throw insertError;
    }
    summary.conflicts++;
  }

  return summary;
}
