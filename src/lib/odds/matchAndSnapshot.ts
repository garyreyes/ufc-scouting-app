import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchMmaOdds } from "./client";
import { decideMatch } from "./matchFights";
import { parseFighterPrices } from "./parseOutcomes";
import type { FightForMatching } from "./types";

export interface MatchAndSnapshotSummary {
  matched: number;
  lowConfidence: number;
  skippedNoPrice: number;
  skippedAlreadySnapshotted: number;
  noCandidates: number;
}

/**
 * One pass over live odds: fetch, match each event against fights that
 * don't already have a snapshot, and write the result. A confident match
 * becomes an odds_snapshots row; a low-confidence one opens a
 * data_conflicts row instead of guessing (ARCHITECTURE.md Fork 5/item #6).
 *
 * This does not decide WHEN to run -- that is roadmap B5's T-12h cadence,
 * with job_runs bookkeeping and a loud-failure banner if it's missed. Safe
 * to call more than once: fights that already have a snapshot are excluded
 * from matching up front, so a re-run can't attempt (and fail against) an
 * immutable row -- see 0013_odds_snapshots.sql's trigger.
 *
 * Deliberately not run against production as part of building this --
 * odds_snapshots is immutable, so a premature write for the wrong fights
 * can't be undone except through the documented drop-trigger escape hatch.
 * The first real run belongs to B5, on its own schedule, or an explicit
 * confirmed dry-run.
 */
export async function matchAndSnapshot(
  supabase: SupabaseClient,
): Promise<MatchAndSnapshotSummary> {
  const summary: MatchAndSnapshotSummary = {
    matched: 0,
    lowConfidence: 0,
    skippedNoPrice: 0,
    skippedAlreadySnapshotted: 0,
    noCandidates: 0,
  };

  const candidates = await fetchUnpricedFights(supabase);
  const oddsEvents = await fetchMmaOdds();

  for (const oddsEvent of oddsEvents) {
    const decision = decideMatch(oddsEvent, candidates);

    if (decision.kind === "no_candidates") {
      summary.noCandidates++;
      continue;
    }

    if (decision.kind === "low_confidence") {
      const { error } = await supabase.from("data_conflicts").insert({
        kind: "low_confidence_odds_match",
        fight_id: decision.fightId,
        details: { oddsEvent, confidence: decision.confidence },
      });
      if (error) throw error;
      summary.lowConfidence++;
      continue;
    }

    // decision.kind === "matched"
    const fight = candidates.find((f) => f.id === decision.fightId);
    if (!fight) continue; // defensive only -- decideMatch only returns ids it was given

    const prices = parseFighterPrices(oddsEvent, fight.fighter1Name, fight.fighter2Name);
    if (!prices) {
      summary.skippedNoPrice++;
      continue;
    }

    const { error } = await supabase.from("odds_snapshots").insert({
      fight_id: fight.id,
      fighter1_price: prices.fighter1Price,
      fighter2_price: prices.fighter2Price,
      odds_event_id: oddsEvent.id,
      raw_response: oddsEvent,
    });
    if (error) {
      // unique(fight_id) racing a concurrent run -- not a reason to abort
      // the rest of the batch.
      summary.skippedAlreadySnapshotted++;
      continue;
    }
    summary.matched++;
  }

  return summary;
}

async function fetchUnpricedFights(supabase: SupabaseClient): Promise<FightForMatching[]> {
  const { data: alreadyPriced, error: pricedError } = await supabase
    .from("odds_snapshots")
    .select("fight_id");
  if (pricedError) throw pricedError;
  const pricedIds = new Set((alreadyPriced ?? []).map((row) => row.fight_id as string));

  // Same PostgREST FK-embed pattern as features/fights/api.ts.
  const { data: fights, error: fightsError } = await supabase
    .from("fights")
    .select(
      "id, fighter1:fighter1_id(name), fighter2:fighter2_id(name), event:event_id(event_date)",
    );
  if (fightsError) throw fightsError;

  type EmbeddedFight = {
    id: string;
    fighter1: { name: string };
    fighter2: { name: string };
    event: { event_date: string };
  };

  return ((fights ?? []) as unknown as EmbeddedFight[])
    .filter((f) => !pricedIds.has(f.id))
    .map((f) => ({
      id: f.id,
      eventDate: f.event.event_date,
      fighter1Name: f.fighter1.name,
      fighter2Name: f.fighter2.name,
    }));
}
