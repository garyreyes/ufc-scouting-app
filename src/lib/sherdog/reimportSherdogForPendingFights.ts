import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllPages } from "../supabase/selectAllPages";
import { importSherdogHistory } from "./importSherdogHistoryJob";
import type { FetchOptions } from "./client";

export interface ReimportPendingSummary {
  pendingFights: number;
  fightersReimported: number;
  boutsWritten: number;
  cappedAt: number;
}

interface Options extends FetchOptions {
  now?: () => Date;
  // At client.ts's 1.5s spacing, 12 fighters is ~18s -- a bounded add to
  // the settlement run. The rest wait for the next run or sherdog.yml's
  // daily --refresh cycle.
  maxFighters?: number;
}

const DEFAULT_MAX_FIGHTERS = 12;

/**
 * J7: the settlement chain's step -1. Sherdog's sidecar refreshes on a
 * ~4-5 day cycle (sherdog.yml `--refresh`), which is too slow to break a
 * fresh result dispute. This re-fetches the Sherdog pages of the fighters
 * in fights that have HAPPENED but not settled and don't yet have a
 * bilateral Sherdog answer -- so applySherdogResults, next in the chain,
 * has current data to work with.
 *
 * Reuses importSherdogHistory's `--sherdog-id` path (one fighter, full
 * guard + reconcile), capped so it can't blow the job timeout.
 */
export async function reimportSherdogForPendingFights(
  supabase: SupabaseClient,
  opts: Options = {},
): Promise<ReimportPendingSummary> {
  const { now = () => new Date(), maxFighters = DEFAULT_MAX_FIGHTERS } = opts;
  const fetchOpts: FetchOptions = { spacingMs: opts.spacingMs, fetchImpl: opts.fetchImpl };
  const summary: ReimportPendingSummary = {
    pendingFights: 0,
    fightersReimported: 0,
    boutsWritten: 0,
    cappedAt: maxFighters,
  };

  const today = now().toISOString().slice(0, 10);

  const unsettled = await selectAllPages<{
    id: string;
    event_id: string;
    fighter1_id: string;
    fighter2_id: string;
    sherdog_bilateral: boolean;
  }>(
    supabase,
    "fights",
    "id, event_id, fighter1_id, fighter2_id, sherdog_bilateral",
    (q) => q.is("settled_at", null),
  );

  const events = await selectAllPages<{ id: string; event_date: string | null }>(
    supabase,
    "events",
    "id, event_date",
  );
  const eventDateById = new Map(events.map((e) => [e.id, e.event_date]));

  const pending = unsettled.filter((f) => {
    if (f.sherdog_bilateral) return false; // already have a firm Sherdog answer
    const date = eventDateById.get(f.event_id);
    return date != null && date <= today; // the fight has actually happened
  });
  summary.pendingFights = pending.length;
  if (pending.length === 0) return summary;

  const fighterIds = [...new Set(pending.flatMap((f) => [f.fighter1_id, f.fighter2_id]))];
  const fighters = await selectAllPages<{ id: string; sherdog_id: number | null }>(
    supabase,
    "fighters",
    "id, sherdog_id",
    (q) => q.in("id", fighterIds),
  );
  const sherdogIds = [
    ...new Set(fighters.map((f) => f.sherdog_id).filter((id): id is number => id != null)),
  ].slice(0, maxFighters);

  for (const sherdogId of sherdogIds) {
    const result = await importSherdogHistory(supabase, { sherdogId, ...fetchOpts });
    summary.fightersReimported += result.imported;
    summary.boutsWritten += result.boutsWritten;
  }

  return summary;
}
