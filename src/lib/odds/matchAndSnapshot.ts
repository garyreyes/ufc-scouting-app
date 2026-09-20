import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchEligibleUnpricedFights, fetchPricedFightIds } from "./eligibleUnpricedFights";
import { decideMatch } from "./matchFights";
import { buildOddsEventDedupeKey } from "./oddsEventDedupeKey";
import { parseFighterPrices } from "./parseOutcomes";
import { selectStaleLowConfidenceConflictIds } from "./selectStaleLowConfidenceConflicts";
import type { OddsEvent } from "./types";

export interface MatchAndSnapshotSummary {
  matched: number;
  lowConfidence: number;
  skippedNoPrice: number;
  skippedAlreadySnapshotted: number;
  noCandidates: number;
  autoClosed: number;
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
    autoClosed: 0,
  };

  const candidates = await fetchEligibleUnpricedFights(supabase, now);

  // Dedup low_confidence_odds_match the same way upsertFight.ts dedups
  // disputed_opponent: the odds job runs every 2h, and a genuinely
  // unmatched recurring odds event would otherwise file a fresh conflict
  // every run (37 such rows accreted from one 2026-09-05 feed anomaly
  // before this guard). One row per odds event is enough -- OPEN OR
  // RESOLVED (M2, widened from open-only). A resolved one already has an
  // answer (either its fight got matched and priced directly by the
  // resolution action, which drops it out of `candidates` regardless, or
  // the owner decided it isn't a real tracked bout at all) -- re-queuing
  // it on the next run would just re-ask a question someone already
  // answered.
  //
  // D4: keyed on the bout's own identity (buildOddsEventDedupeKey), not
  // oddsEvent.id -- the feed re-emitted the same bout under a NEW id with
  // a spelling variant ("Łukasz Charzewski" vs "Lukasz Charzewski"), and
  // an id-keyed dedup let both file separately.
  const { data: oddsConflicts, error: conflictsError } = await supabase
    .from("data_conflicts")
    .select("id, details, resolved_at")
    .eq("kind", "low_confidence_odds_match");
  if (conflictsError) throw conflictsError;
  const conflictRows = (oddsConflicts ?? []) as {
    id: string;
    details: { oddsEvent?: OddsEvent; candidateFightId?: string | null };
    resolved_at: string | null;
  }[];
  const alreadyQueuedKeys = new Set(
    conflictRows.map((row) => row.details.oddsEvent).filter((e): e is OddsEvent => Boolean(e)).map(buildOddsEventDedupeKey),
  );

  // D3: a low_confidence_odds_match's candidate fight can get priced
  // through a path other than resolving that exact row -- a different,
  // more confident odds event, or a manual resolution -- and the row
  // would otherwise accrete forever (5 such rows found live, all
  // `snaps = 1`, 2026-09-20).
  const pricedFightIds = await fetchPricedFightIds(supabase);
  const staleIds = selectStaleLowConfidenceConflictIds(
    conflictRows.filter((row) => row.resolved_at === null),
    pricedFightIds,
  );
  if (staleIds.length > 0) {
    const { error } = await supabase
      .from("data_conflicts")
      .update({ resolved_at: now.toISOString(), resolution: "fight_priced_elsewhere" })
      .in("id", staleIds);
    if (error) throw error;
    summary.autoClosed = staleIds.length;
  }

  for (const oddsEvent of oddsEvents) {
    const decision = decideMatch(oddsEvent, candidates);

    if (decision.kind === "no_candidates") {
      summary.noCandidates++;
      continue;
    }

    if (decision.kind === "low_confidence") {
      const key = buildOddsEventDedupeKey(oddsEvent);
      if (alreadyQueuedKeys.has(key)) {
        summary.lowConfidence++;
        continue;
      }
      // fight_id is deliberately null here, not decision.fightId --
      // 0014_data_conflicts.sql's own design: an unmatched odds event
      // doesn't identify a specific fight with enough confidence to
      // block it, so that fight must stay "unpriced" (pickable, just not
      // bettable yet), never "disputed" (blocked from picking too). The
      // algorithm's best guess still travels in `details` for B6's
      // resolution screen to show as a starting point, not a verdict.
      const { error } = await supabase.from("data_conflicts").insert({
        kind: "low_confidence_odds_match",
        fight_id: null,
        details: { oddsEvent, confidence: decision.confidence, candidateFightId: decision.fightId },
      });
      if (error) throw error;
      alreadyQueuedKeys.add(key);
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
