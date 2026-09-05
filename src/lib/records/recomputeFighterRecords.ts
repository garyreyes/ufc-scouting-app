import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllPages } from "../supabase/selectAllPages";
import { deriveFighterRecords, type FighterRecord } from "./deriveFighterRecords";

export interface RecomputeRecordsSummary {
  fightsCounted: number;
  fightersUpdated: number;
}

// One .in() filter goes into the query STRING, so a few hundred uuids at
// 37 characters each would build a URL long enough to be rejected.
const UPDATE_CHUNK_SIZE = 100;

const ZERO: FighterRecord = { wins: 0, losses: 0, draws: 0 };

/**
 * The I/O half of the record feature (I5) -- deriveFighterRecords.ts owns
 * the counting rules, this owns reading the fight graph and writing the
 * result back onto fighters.wins/losses/draws.
 *
 * Deliberately shaped like recomputeEloRatings.ts, and called from the
 * same place for the same reason: the moment a new result is discovered
 * is the moment a record changes. A full recount every time, never an
 * incremental patch -- results arrive out of order all the time (a
 * disputed bout settles late, a backfill imports years at once), and a
 * correction to an old fight has to be able to change a record that was
 * already written.
 *
 * **Writes are column-scoped, and that is a hard requirement, not a
 * style preference.** `fighters` rows are concurrently written by the
 * enrichment job and both sync runs. A whole-row upsert built from the
 * read at the top of this function would carry stale values for
 * height_cm/reach_cm/stance/external_id and silently undo whatever those
 * jobs wrote in between. Only the three count columns are ever sent.
 *
 * Only fighters whose record actually CHANGED are written. The first run
 * touches nearly every fighter; every run after touches a handful,
 * because most records do not move between settlements. Fighters with no
 * countable outcome are reset to 0-0-0 rather than left holding a stale
 * count -- deriveFighterRecords omits them from its map precisely so
 * this step can tell "counted, found nothing" apart from "never looked."
 */
export async function recomputeFighterRecords(
  supabase: SupabaseClient,
): Promise<RecomputeRecordsSummary> {
  const fightRows = await selectAllPages<{
    id: string;
    fighter1_id: string;
    fighter2_id: string;
    winner_id: string | null;
    method: string | null;
  }>(supabase, "fights", "id, fighter1_id, fighter2_id, winner_id, method");

  const fighterRows = await selectAllPages<{
    id: string;
    wins: number;
    losses: number;
    draws: number;
  }>(supabase, "fighters", "id, wins, losses, draws");

  const derived = deriveFighterRecords(
    fightRows.map((f) => ({
      fighter1Id: f.fighter1_id,
      fighter2Id: f.fighter2_id,
      winnerId: f.winner_id,
      method: f.method,
    })),
  );

  // Grouped by the record itself, so the whole roster is written in a
  // handful of requests rather than one per fighter -- there are only
  // ever a few dozen distinct W-L-D triples across hundreds of fighters.
  const idsByRecord = new Map<string, { record: FighterRecord; ids: string[] }>();
  for (const row of fighterRows) {
    const target = derived.get(row.id) ?? ZERO;
    if (target.wins === row.wins && target.losses === row.losses && target.draws === row.draws) {
      continue;
    }
    const key = `${target.wins}-${target.losses}-${target.draws}`;
    const group = idsByRecord.get(key);
    if (group) group.ids.push(row.id);
    else idsByRecord.set(key, { record: target, ids: [row.id] });
  }

  let fightersUpdated = 0;
  for (const { record, ids } of idsByRecord.values()) {
    for (let i = 0; i < ids.length; i += UPDATE_CHUNK_SIZE) {
      const chunk = ids.slice(i, i + UPDATE_CHUNK_SIZE);
      // .select("id") so the count reflects rows PostgREST actually
      // matched, not ids sent -- a fighter deleted between the read
      // above and this write would otherwise be counted as updated when
      // it wasn't touched at all. This number lands in job_runs and is
      // what a later debugging session would trust at face value.
      const { data, error } = await supabase
        .from("fighters")
        .update({ wins: record.wins, losses: record.losses, draws: record.draws })
        .in("id", chunk)
        .select("id");
      if (error) throw error;
      fightersUpdated += data?.length ?? 0;
    }
  }

  return { fightsCounted: fightRows.length, fightersUpdated };
}
