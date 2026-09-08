import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchFighterHtmlById, type FetchOptions } from "./client";
import { parseFighterName, parseFinishBreakdown, parseHeadlineRecord } from "./parseFighterPage";
import { parseFightHistory } from "./parseFightHistory";
import { sherdogNameMatchesExpected } from "./identityGuard";
import { buildSherdogBoutRows } from "./buildSherdogBoutRows";

export interface SherdogImportSummary {
  attempted: number;
  imported: number;
  skipped: number; // cross-check failed -- left for a later run
  guardRejected: number; // page name no longer matches (surprising -- J3 verified these)
  boutsWritten: number;
  finishNulled: number; // imported, but the finish breakdown didn't reconcile
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
  refresh?: boolean; // re-import fighters already done (page changed)
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
  const { batchSize = DEFAULT_BATCH_SIZE, dryRun = false, refresh = false, now = () => new Date() } = opts;
  const fetchOpts: FetchOptions = { spacingMs: opts.spacingMs, fetchImpl: opts.fetchImpl };

  const summary: SherdogImportSummary = {
    attempted: 0,
    imported: 0,
    skipped: 0,
    guardRejected: 0,
    boutsWritten: 0,
    finishNulled: 0,
    failed: 0,
    dryRun,
  };

  let query = supabase
    .from("fighters")
    .select("id, name, sherdog_id")
    .not("sherdog_id", "is", null)
    .limit(batchSize);
  if (!refresh) query = query.is("sherdog_history_imported_at", null);

  const { data, error } = await query;
  if (error) throw error;
  const queue = (data as Array<{ id: string; name: string; sherdog_id: number }>) ?? [];

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

      if (built.finish === null) summary.finishNulled++;
      summary.boutsWritten += built.bouts.length;

      if (dryRun) {
        const f = built.finish;
        console.log(
          `  ${fighter.name} -> ${built.bouts.length} bouts` +
            (f
              ? ` | W ${f.sherdog_wins_by_ko}KO/${f.sherdog_wins_by_sub}S/${f.sherdog_wins_by_dec}D` +
                ` L ${f.sherdog_losses_by_ko}KO/${f.sherdog_losses_by_sub}S/${f.sherdog_losses_by_dec}D`
              : " | finish breakdown did not reconcile -> null"),
        );
        continue;
      }

      const importedAt = now().toISOString();

      const { error: delError } = await supabase
        .from("fighter_sherdog_bouts")
        .delete()
        .eq("fighter_id", fighter.id);
      if (delError) throw delError;

      if (built.bouts.length > 0) {
        const { error: insError } = await supabase.from("fighter_sherdog_bouts").insert(
          built.bouts.map((b) => ({ ...b, fighter_id: fighter.id, imported_at: importedAt })),
        );
        if (insError) throw insError;
      }

      const { error: updError } = await supabase
        .from("fighters")
        .update({
          ...(built.finish ?? NULL_FINISH),
          sherdog_history_imported_at: importedAt,
        })
        .eq("id", fighter.id);
      if (updError) throw updError;

      summary.imported++;
    } catch (err) {
      summary.failed++;
      console.error(`Sherdog import failed for "${fighter.name}" (#${fighter.sherdog_id}):`, err);
    }
  }

  return summary;
}
