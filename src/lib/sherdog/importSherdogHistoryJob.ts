import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchFighterHtmlById, type FetchOptions } from "./client";
import { parseBio, parseFighterName, parseFinishBreakdown, parseHeadlineRecord } from "./parseFighterPage";
import { parseFightHistory } from "./parseFightHistory";
import { sherdogNameMatchesExpected } from "./identityGuard";
import { buildSherdogBoutRows } from "./buildSherdogBoutRows";
import { bioFillPayload } from "./bioFillPayload";

export interface SherdogImportSummary {
  attempted: number;
  imported: number;
  skipped: number; // cross-check failed -- left for a later run
  guardRejected: number; // page name no longer matches (surprising -- J3 verified these)
  boutsWritten: number;
  finishNulled: number; // imported, but the finish breakdown didn't reconcile
  bioFilled: number; // had a null height_cm / weight_kg that Sherdog filled (J6)
  failed: number;
  dryRun: boolean;
}

// One page fetch per fighter, ~128 with a sherdog_id. At client.ts's 1.5s
// spacing 60 is ~90s -- well inside the job timeout, two runs clear the
// backlog. Sherdog is unmetered, so this is a timeout cap only.
export const DEFAULT_BATCH_SIZE = 60;

interface Options extends FetchOptions {
  batchSize?: number;
  dryRun?: boolean;
  // Re-import fighters already done (a Sherdog page changed). Ordered
  // oldest-imported-first so repeated --refresh runs progress through the
  // whole roster instead of re-reading the same arbitrary page.
  refresh?: boolean;
  // Re-import exactly one fighter by their Sherdog id -- the targeted
  // form of --refresh.
  sherdogId?: number;
  now?: () => Date;
}

const NULL_FINISH = {
  sherdog_wins_by_ko: null,
  sherdog_wins_by_sub: null,
  sherdog_wins_by_dec: null,
  sherdog_losses_by_ko: null,
  sherdog_losses_by_sub: null,
  sherdog_losses_by_dec: null,
};

/**
 * J4: fill fighter_sherdog_bouts + the sherdog_*_by_* finish columns for
 * every fighter that has a sherdog_id but no history yet.
 *
 * Read-only sidecar -- writes NOTHING into fights / events / other
 * fighters. Per fighter: re-run the page-name guard, parse, and only if
 * the page reconciles with its own headline record (buildSherdogBoutRows)
 * replace that fighter's bout rows and set the finish columns +
 * sherdog_history_imported_at. A fighter whose page doesn't check out is
 * skipped and left unmarked for a later run.
 *
 * `dryRun: true` fetches + parses everything and writes nothing.
 */
export async function importSherdogHistory(
  supabase: SupabaseClient,
  opts: Options = {},
): Promise<SherdogImportSummary> {
  const { batchSize = DEFAULT_BATCH_SIZE, dryRun = false, refresh = false, sherdogId, now = () => new Date() } = opts;
  const fetchOpts: FetchOptions = { spacingMs: opts.spacingMs, fetchImpl: opts.fetchImpl };

  const summary: SherdogImportSummary = {
    attempted: 0,
    imported: 0,
    skipped: 0,
    guardRejected: 0,
    boutsWritten: 0,
    finishNulled: 0,
    bioFilled: 0,
    failed: 0,
    dryRun,
  };

  let query = supabase
    .from("fighters")
    .select("id, name, sherdog_id, height_cm, weight_kg")
    .not("sherdog_id", "is", null);

  if (sherdogId !== undefined) {
    query = query.eq("sherdog_id", sherdogId);
  } else if (refresh) {
    // Oldest import first (never-imported ahead of that), so repeated
    // --refresh runs actually walk the whole roster rather than
    // re-reading whatever PostgREST returns first.
    query = query.order("sherdog_history_imported_at", { ascending: true, nullsFirst: true }).limit(batchSize);
  } else {
    // The self-healing queue: an imported fighter drops out of this
    // filter, so progress is guaranteed regardless of order (same shape
    // as enrichFighters.ts / the J3 identity job).
    query = query.is("sherdog_history_imported_at", null).order("id").limit(batchSize);
  }

  const { data, error } = await query;
  if (error) throw error;
  const queue =
    (data as Array<{
      id: string;
      name: string;
      sherdog_id: number;
      height_cm: number | null;
      weight_kg: number | null;
    }>) ?? [];

  for (const fighter of queue) {
    summary.attempted++;
    try {
      const html = await fetchFighterHtmlById(fighter.sherdog_id, fetchOpts);
      const pageName = parseFighterName(html) ?? "";
      if (!sherdogNameMatchesExpected(fighter.name, pageName)) {
        summary.guardRejected++;
        console.warn(
          `Sherdog import: page #${fighter.sherdog_id} for "${fighter.name}" is now "${pageName}" -- skipping`,
        );
        continue;
      }

      const built = buildSherdogBoutRows(
        parseFightHistory(html),
        parseFinishBreakdown(html),
        parseHeadlineRecord(html),
      );
      if (!built.ok) {
        summary.skipped++;
        console.warn(`Sherdog import: skipping "${fighter.name}" (#${fighter.sherdog_id}) -- ${built.reason}`);
        continue;
      }

      // J6: fill height_cm / weight_kg from Sherdog's bio where they're
      // still null. Never overwrites -- Sherdog has no reach/stance, so
      // API-Sports enrichment still runs for those.
      const bioFill = bioFillPayload(fighter, parseBio(html));

      if (built.finish === null) summary.finishNulled++;
      if (Object.keys(bioFill).length > 0) summary.bioFilled++;
      summary.boutsWritten += built.bouts.length;

      if (dryRun) {
        const f = built.finish;
        const bio = Object.keys(bioFill).length > 0 ? ` | +${Object.keys(bioFill).join("/")}` : "";
        console.log(
          `  ${fighter.name} -> ${built.bouts.length} bouts` +
            (f
              ? ` | W ${f.sherdog_wins_by_ko}KO/${f.sherdog_wins_by_sub}S/${f.sherdog_wins_by_dec}D` +
                ` L ${f.sherdog_losses_by_ko}KO/${f.sherdog_losses_by_sub}S/${f.sherdog_losses_by_dec}D`
              : " | finish breakdown did not reconcile -> null") +
            bio,
        );
        continue;
      }

      const importedAt = now().toISOString();

      try {
        // Upsert on (fighter_id, bout_order) then delete the stale tail,
        // rather than delete-all-then-insert: there is never a window
        // where the fighter has zero bout rows, and a mid-write failure
        // leaves the previous career mostly intact instead of blank.
        if (built.bouts.length > 0) {
          const { error: upErr } = await supabase
            .from("fighter_sherdog_bouts")
            .upsert(
              built.bouts.map((b) => ({ ...b, fighter_id: fighter.id, imported_at: importedAt })),
              { onConflict: "fighter_id,bout_order" },
            );
          if (upErr) throw upErr;
        }
        const { error: tailErr } = await supabase
          .from("fighter_sherdog_bouts")
          .delete()
          .eq("fighter_id", fighter.id)
          .gte("bout_order", built.bouts.length);
        if (tailErr) throw tailErr;

        const { error: updError } = await supabase
          .from("fighters")
          .update({ ...(built.finish ?? NULL_FINISH), ...bioFill, sherdog_history_imported_at: importedAt })
          .eq("id", fighter.id);
        if (updError) throw updError;
      } catch (writeErr) {
        // A write failed partway. Clear the marker so a NORMAL run
        // re-queues this fighter -- otherwise a --refresh failure would
        // strand them (the default queue filters on the marker being
        // null).
        await supabase
          .from("fighters")
          .update({ sherdog_history_imported_at: null })
          .eq("id", fighter.id);
        throw writeErr;
      }

      summary.imported++;
    } catch (err) {
      summary.failed++;
      console.error(`Sherdog import failed for "${fighter.name}" (#${fighter.sherdog_id}):`, err);
    }
  }

  return summary;
}
