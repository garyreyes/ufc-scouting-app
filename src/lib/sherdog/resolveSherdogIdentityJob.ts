import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllPages } from "../supabase/selectAllPages";
import { fetchFighterHtmlById, type FetchOptions } from "./client";
import { parseFighterName } from "./parseFighterPage";
import { searchSherdogFighters } from "./searchFighters";
import { decideSherdogIdentity, rankSherdogCandidates } from "./resolveSherdogIdentity";
import { sherdogNameMatchesExpected } from "./identityGuard";
import { buildSherdogConflictInsert, buildSherdogIdentityUpdate } from "./buildSherdogIdentityWrites";

export interface SherdogIdentitySummary {
  attempted: number;
  matched: number;
  queued: number; // low_confidence_sherdog_match conflicts opened
  guardRejected: number; // search matched but the fetched page's name did not -- also queued
  noCandidates: number;
  failed: number;
  dryRun: boolean;
}

// The upcoming-card population is ~150 fighters (ROADMAP Phase I). At ~2
// Sherdog requests per matched fighter and client.ts's 1.5s spacing,
// 100 is ~5 min -- inside the 15-min job timeout, and two runs clear the
// backlog. Sherdog costs no metered budget, so this is purely a
// timeout-safety cap, not a quota one.
export const DEFAULT_BATCH_SIZE = 100;

const ID_CHUNK = 100; // keep any .in() list well under the URL-length wall

interface Options extends FetchOptions {
  batchSize?: number;
  dryRun?: boolean;
  now?: () => Date;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * J3: resolve fighters.sherdog_id for fighters on upcoming cards.
 *
 * Queue = a fighter on an event dated today or later, with sherdog_id
 * null and sherdog_checked_at null -- "not resolved, not yet attempted"
 * IS the queue, the same resumable-by-construction shape enrichFighters.ts
 * uses. sherdog_checked_at is stamped on every terminal outcome (matched,
 * queued for review, absent from Sherdog) so a fighter is searched once.
 *
 * `dryRun: true` performs every read and every Sherdog fetch but writes
 * NOTHING -- no fighters update, no data_conflicts insert, no
 * sherdog_checked_at. Run it against production first; the summary tells
 * you how many auto-match, how many land in the review queue, and how
 * many Sherdog doesn't have, before a single row changes.
 */
export async function resolveSherdogIdentity(
  supabase: SupabaseClient,
  opts: Options = {},
): Promise<SherdogIdentitySummary> {
  const { batchSize = DEFAULT_BATCH_SIZE, dryRun = false, now = () => new Date() } = opts;
  const fetchOpts: FetchOptions = { spacingMs: opts.spacingMs, fetchImpl: opts.fetchImpl };

  const summary: SherdogIdentitySummary = {
    attempted: 0,
    matched: 0,
    queued: 0,
    guardRejected: 0,
    noCandidates: 0,
    failed: 0,
    dryRun,
  };

  const today = now().toISOString().slice(0, 10);

  const events = await selectAllPages<{ id: string }>(supabase, "events", "id", (q) =>
    q.gte("event_date", today),
  );
  if (events.length === 0) return summary;

  const fights: Array<{ fighter1_id: string; fighter2_id: string }> = [];
  for (const eventChunk of chunk(events.map((e) => e.id), ID_CHUNK)) {
    const rows = await selectAllPages<{ id: string; fighter1_id: string; fighter2_id: string }>(
      supabase,
      "fights",
      "id, fighter1_id, fighter2_id",
      (q) => q.in("event_id", eventChunk),
    );
    fights.push(...rows);
  }

  const cardFighterIds = [...new Set(fights.flatMap((f) => [f.fighter1_id, f.fighter2_id]))];
  if (cardFighterIds.length === 0) return summary;

  const queue: Array<{ id: string; name: string }> = [];
  for (const idChunk of chunk(cardFighterIds, ID_CHUNK)) {
    const { data, error } = await supabase
      .from("fighters")
      .select("id, name")
      .in("id", idChunk)
      .is("sherdog_id", null)
      .is("sherdog_checked_at", null);
    if (error) throw error;
    queue.push(...((data as Array<{ id: string; name: string }>) ?? []));
    if (queue.length >= batchSize) break;
  }

  for (const fighter of queue.slice(0, batchSize)) {
    summary.attempted++;
    const checkedAt = now().toISOString();
    try {
      const candidates = await searchSherdogFighters(fighter.name, fetchOpts);
      const decision = decideSherdogIdentity(fighter.name, candidates);

      if (decision.kind === "no_candidates") {
        summary.noCandidates++;
        if (dryRun) console.log(`  no Sherdog result   ${fighter.name}`);
        if (!dryRun) await markChecked(supabase, fighter.id, checkedAt);
        continue;
      }

      if (decision.kind === "low_confidence") {
        summary.queued++;
        if (dryRun) {
          const ranked = rankSherdogCandidates(fighter.name, candidates);
          console.log(
            `  review queue        ${fighter.name} -> best "${ranked[0]?.name}" ` +
              `#${ranked[0]?.sherdogId} @ ${ranked[0]?.confidence.toFixed(2)} (${candidates.length} candidates)`,
          );
        }
        if (!dryRun) {
          await openConflict(supabase, fighter, candidates);
          await markChecked(supabase, fighter.id, checkedAt);
        }
        continue;
      }

      // decision.kind === "matched" -- second gate: the fetched page's
      // own name must still plausibly be this fighter (a wrong id returns
      // HTTP 200 for a different person).
      const pageHtml = await fetchFighterHtmlById(decision.sherdogId, fetchOpts);
      const pageName = parseFighterName(pageHtml) ?? "";
      if (!sherdogNameMatchesExpected(fighter.name, pageName)) {
        summary.guardRejected++;
        summary.queued++;
        if (dryRun) {
          console.log(
            `  guard rejected      ${fighter.name} -> page #${decision.sherdogId} is "${pageName}"`,
          );
        }
        if (!dryRun) {
          await openConflict(supabase, fighter, candidates);
          await markChecked(supabase, fighter.id, checkedAt);
        }
        continue;
      }

      summary.matched++;
      if (dryRun) {
        console.log(
          `  auto-match          ${fighter.name} -> #${decision.sherdogId} "${pageName}" @ ${decision.confidence.toFixed(2)}`,
        );
      }
      if (!dryRun) {
        const { error } = await supabase
          .from("fighters")
          .update(buildSherdogIdentityUpdate(decision.sherdogId, checkedAt))
          .eq("id", fighter.id);
        if (error) throw error;
      }
    } catch (err) {
      summary.failed++;
      console.error(`Sherdog identity failed for fighter ${fighter.id} (${fighter.name}):`, err);
    }
  }

  return summary;
}

async function markChecked(supabase: SupabaseClient, fighterId: string, checkedAt: string): Promise<void> {
  const { error } = await supabase
    .from("fighters")
    .update({ sherdog_checked_at: checkedAt })
    .eq("id", fighterId);
  if (error) throw error;
}

async function openConflict(
  supabase: SupabaseClient,
  fighter: { id: string; name: string },
  candidates: Awaited<ReturnType<typeof searchSherdogFighters>>,
): Promise<void> {
  const ranked = rankSherdogCandidates(fighter.name, candidates);
  const { error } = await supabase
    .from("data_conflicts")
    .insert(buildSherdogConflictInsert(fighter.id, fighter.name, ranked, candidates));
  if (error) throw error;
}
