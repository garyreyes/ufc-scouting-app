import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllPages } from "../supabase/selectAllPages";
import {
  matchSherdogFightResult,
  type FightForSherdogMatch,
  type SherdogBoutForMatch,
} from "./matchSherdogFightResult";

export interface ApplySherdogResultsSummary {
  fightsChecked: number;
  matched: number;
  written: number;
  ambiguous: number;
  noData: number;
  dryRun: boolean;
}

interface Options {
  dryRun?: boolean;
  now?: () => Date;
  // Only look at fights whose event is on or before (today + this many
  // days). A fight further out has no Sherdog bout yet -- the matcher
  // returns no_data -- so this just avoids the wasted bout fetch.
  lookAheadDays?: number;
}

/**
 * J7: reads the Sherdog history sidecar against every not-yet-settled
 * fight and writes what Sherdog thinks happened into
 * `fights.sherdog_winner_id` / `sherdog_method` / `sherdog_round` /
 * `sherdog_reported_at` / `sherdog_bilateral` -- the same "a source
 * reported a result" write that upsertFight.ts does for Wikipedia and
 * API-Sports, just sourced from the already-imported sidecar rather than
 * a live fetch.
 *
 * All the judgement is in matchSherdogFightResult (pure, tested): match
 * on `opponent_sherdog_id` + an event-date window, and only when it is
 * unambiguous. `sherdog_reported_at` is set once (the single-source
 * timeout clock); the winner / method / round / bilateral flag are
 * refreshed on every run while the fight is unsettled, so a later import
 * that turns a one-sided match bilateral is picked up.
 *
 * Runs first in runSettlementJobsOnce, so settleFights sees the freshest
 * Sherdog opinion in the same pass.
 */
export async function applySherdogResults(
  supabase: SupabaseClient,
  opts: Options = {},
): Promise<ApplySherdogResultsSummary> {
  const { dryRun = false, now = () => new Date(), lookAheadDays = 2 } = opts;
  const summary: ApplySherdogResultsSummary = {
    fightsChecked: 0,
    matched: 0,
    written: 0,
    ambiguous: 0,
    noData: 0,
    dryRun,
  };

  const cutoff = new Date(now().getTime() + lookAheadDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const unsettled = await selectAllPages<{
    id: string;
    event_id: string;
    fighter1_id: string;
    fighter2_id: string;
    sherdog_winner_id: string | null;
    sherdog_reported_at: string | null;
    sherdog_bilateral: boolean;
  }>(
    supabase,
    "fights",
    "id, event_id, fighter1_id, fighter2_id, sherdog_winner_id, sherdog_reported_at, sherdog_bilateral",
    (q) => q.is("settled_at", null),
  );

  const events = await selectAllPages<{ id: string; event_date: string | null }>(
    supabase,
    "events",
    "id, event_date",
  );
  const eventDateById = new Map(events.map((e) => [e.id, e.event_date]));

  const inScope = unsettled.filter((f) => {
    const date = eventDateById.get(f.event_id);
    return date !== null && date !== undefined && date <= cutoff;
  });
  if (inScope.length === 0) return summary;

  const fighterIds = [...new Set(inScope.flatMap((f) => [f.fighter1_id, f.fighter2_id]))];
  const fighters = await selectAllPages<{ id: string; sherdog_id: number | null }>(
    supabase,
    "fighters",
    "id, sherdog_id",
    (q) => q.in("id", fighterIds),
  );
  const sherdogIdByFighter = new Map(fighters.map((f) => [f.id, f.sherdog_id]));

  const bothLinked = inScope.filter(
    (f) =>
      sherdogIdByFighter.get(f.fighter1_id) != null && sherdogIdByFighter.get(f.fighter2_id) != null,
  );
  summary.fightsChecked = bothLinked.length;
  if (bothLinked.length === 0) return summary;

  const boutFighterIds = [...new Set(bothLinked.flatMap((f) => [f.fighter1_id, f.fighter2_id]))];
  const allBouts = await selectAllPages<{
    id: string;
    fighter_id: string;
    opponent_sherdog_id: number | null;
    result: SherdogBoutForMatch["result"];
    event_date: string | null;
    method: string | null;
    round: number | null;
  }>(
    supabase,
    "fighter_sherdog_bouts",
    "id, fighter_id, opponent_sherdog_id, result, event_date, method, round",
    (q) => q.in("fighter_id", boutFighterIds),
  );
  const boutsByFighter = new Map<string, SherdogBoutForMatch[]>();
  for (const b of allBouts) {
    const list = boutsByFighter.get(b.fighter_id) ?? [];
    list.push(b);
    boutsByFighter.set(b.fighter_id, list);
  }

  const nowIso = now().toISOString();

  for (const fight of bothLinked) {
    const forMatch: FightForSherdogMatch = {
      fighter1_id: fight.fighter1_id,
      fighter1_sherdog_id: sherdogIdByFighter.get(fight.fighter1_id) ?? null,
      fighter2_id: fight.fighter2_id,
      fighter2_sherdog_id: sherdogIdByFighter.get(fight.fighter2_id) ?? null,
      event_date: eventDateById.get(fight.event_id) as string,
    };
    const bouts = [
      ...(boutsByFighter.get(fight.fighter1_id) ?? []),
      ...(boutsByFighter.get(fight.fighter2_id) ?? []),
    ];

    const match = matchSherdogFightResult(forMatch, bouts);
    if (match.status === "ambiguous") {
      summary.ambiguous++;
      continue;
    }
    if (match.status === "no_data") {
      summary.noData++;
      continue;
    }
    summary.matched++;

    const unchanged =
      fight.sherdog_reported_at !== null &&
      fight.sherdog_winner_id === match.winnerId &&
      fight.sherdog_bilateral === match.bilateral;
    if (unchanged) continue;

    if (dryRun) {
      console.log(
        `[dry-run] fight ${fight.id}: sherdog winner=${match.winnerId ?? "draw/nc"} ` +
          `bilateral=${match.bilateral} method=${match.method ?? "-"} round=${match.round ?? "-"}`,
      );
      summary.written++;
      continue;
    }

    const payload: Record<string, unknown> = {
      sherdog_winner_id: match.winnerId,
      sherdog_method: match.method,
      sherdog_round: match.round,
      sherdog_bilateral: match.bilateral,
    };
    if (fight.sherdog_reported_at === null) payload.sherdog_reported_at = nowIso;

    const { error } = await supabase.from("fights").update(payload).eq("id", fight.id);
    if (error) throw error;
    summary.written++;
  }

  return summary;
}
