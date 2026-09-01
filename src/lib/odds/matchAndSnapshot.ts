import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchEligibleUnpricedFights } from "./eligibleUnpricedFights";
import { decideMatch } from "./matchFights";
import { parseFighterPrices } from "./parseOutcomes";
import type { OddsEvent } from "./types";

export interface MatchAndSnapshotSummary {
  matched: number;
  lowConfidence: number;
  skippedNoPrice: number;
  skippedAlreadySnapshotted: number;
  noCandidates: number;
}

/**
 * One pass over live odds: match each event against fights that are both
 * unpriced AND past their card's T-12h snapshot window (snapshotWindow.ts),
 * and write the result. A confident match becomes an odds_snapshots row; a
 * low-confidence one opens a data_conflicts row instead of guessing
 * (ARCHITECTURE.md Fork 5/item #6).
 *
 * Takes `oddsEvents` as a parameter rather than fetching them itself, so
 * B5's combined runner can share one fetchMmaOdds() call with
 * discoverStartTimes rather than doubling the daily credit spend.
 *
 * Safe to call more than once: fights that already have a snapshot are
 * excluded from matching up front, so a re-run can't attempt (and fail
 * against) an immutable row -- see 0013_odds_snapshots.sql's trigger. The
 * T-12h gate is the other half of that safety: without it, the very first
 * run after B4 discovers a card's starts_at would freeze a price weeks
 * early, which is just as permanent as an overwrite.
 */
export async function matchAndSnapshot(
  supabase: SupabaseClient,
  oddsEvents: OddsEvent[],
  now: Date = new Date(),
): Promise<MatchAndSnapshotSummary> {
  const summary: MatchAndSnapshotSummary = {
    matched: 0,
    lowConfidence: 0,
    skippedNoPrice: 0,
    skippedAlreadySnapshotted: 0,
    noCandidates: 0,
  };

  const candidates = await fetchEligibleUnpricedFights(supabase, now);

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
