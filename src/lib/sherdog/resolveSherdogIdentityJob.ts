import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllPages } from "../supabase/selectAllPages";
import { selectAllPagesByIds } from "../supabase/selectAllPagesByIds";
import { chunk, DEFAULT_CHUNK_SIZE } from "../supabase/chunk";
import { fetchFighterHtmlById, type FetchOptions } from "./client";
import { parseFighterName } from "./parseFighterPage";
import { searchSherdogFighters } from "./searchFighters";
import type { SherdogSearchCandidate } from "./parseSearch";
import {
  AMBIGUOUS_TIEBREAK_MAX_CANDIDATES,
  decideSherdogIdentity,
  pickTiebreakWinner,
  rankSherdogCandidates,
  tiedTopCandidates,
} from "./resolveSherdogIdentity";
import { parseFightHistory, type SherdogHistoryFight } from "./parseFightHistory";
import { sherdogNameMatchesExpected } from "./identityGuard";
import {
  buildSherdogConflictInsert,
  buildSherdogIdCollisionInsert,
  buildSherdogIdentityUpdate,
} from "./buildSherdogIdentityWrites";
import { isSherdogIdCollisionError } from "./isSherdogIdCollisionError";
import { historyCorroborates, type KnownOpponentBout } from "./historyCorroborates";
import { fetchKnownOpponentBouts } from "./fetchKnownOpponentBouts";

export interface SherdogIdentitySummary {
  attempted: number;
  matched: number;
  historyMatched: number; // of `matched`, how many via M5's history corroboration
  queued: number; // low_confidence_sherdog_match conflicts opened
  guardRejected: number; // search matched but the fetched page's name did not -- also queued
  noCandidates: number;
  // P6: a match this run WOULD have written, but fighters.sherdog_id was
  // already claimed by a different fighter row -- opened as a
  // sherdog_id_collision review proposal instead of counted as `failed`.
  collision: number;
  failed: number;
  dryRun: boolean;
}

// The upcoming-card population is ~150 fighters (ROADMAP Phase I). At ~2
// Sherdog requests per matched fighter and client.ts's 1.5s spacing,
// 100 is ~5 min -- inside the 15-min job timeout, and two runs clear the
// backlog. Sherdog costs no metered budget, so this is purely a
// timeout-safety cap, not a quota one.
export const DEFAULT_BATCH_SIZE = 100;

interface Options extends FetchOptions {
  batchSize?: number;
  dryRun?: boolean;
  now?: () => Date;
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
export async function resolveUpcomingCardSherdogIds(
  supabase: SupabaseClient,
  opts: Options = {},
): Promise<SherdogIdentitySummary> {
  const { batchSize = DEFAULT_BATCH_SIZE, dryRun = false, now = () => new Date() } = opts;
  const fetchOpts: FetchOptions = { spacingMs: opts.spacingMs, fetchImpl: opts.fetchImpl };

  const summary: SherdogIdentitySummary = {
    attempted: 0,
    matched: 0,
    historyMatched: 0,
    queued: 0,
    guardRejected: 0,
    noCandidates: 0,
    collision: 0,
    failed: 0,
    dryRun,
  };

  const today = now().toISOString().slice(0, 10);

  const events = await selectAllPages<{ id: string }>(supabase, "events", "id", (q) =>
    q.gte("event_date", today),
  );
  if (events.length === 0) return summary;

  const fights = await selectAllPagesByIds<{ id: string; fighter1_id: string; fighter2_id: string }>(
    supabase,
    "fights",
    "id, fighter1_id, fighter2_id",
    "event_id",
    events.map((e) => e.id),
  );

  const cardFighterIds = [...new Set(fights.flatMap((f) => [f.fighter1_id, f.fighter2_id]))];
  if (cardFighterIds.length === 0) return summary;

  const queue: Array<{ id: string; name: string }> = [];
  for (const idChunk of chunk(cardFighterIds, DEFAULT_CHUNK_SIZE)) {
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

  // no_candidates fighters are held here, not marked checked inline: a
  // Sherdog results-table markup change makes EVERY search look empty,
  // and marking a whole batch "checked, not in Sherdog" would bury those
  // fighters permanently with no error. They're only committed at the
  // end, and only if the miss rate looks like real absences rather than
  // a parser regression.
  const notFound: string[] = [];

  for (const fighter of queue.slice(0, batchSize)) {
    summary.attempted++;
    const checkedAt = now().toISOString();
    try {
      const candidates = await searchSherdogFighters(fighter.name, fetchOpts);
      const decision = decideSherdogIdentity(fighter.name, candidates);

      if (decision.kind === "no_candidates") {
        summary.noCandidates++;
        if (dryRun) console.log(`  no Sherdog result   ${fighter.name}`);
        notFound.push(fighter.id);
        continue;
      }

      if (decision.kind === "low_confidence") {
        // M5: before either fallback below, try history corroboration
        // across EVERY returned candidate (not just the name-tied top
        // ones) -- a strictly stronger signal than name similarity, and
        // the only thing that can ever resolve a pure nickname-storage
        // mismatch (name similarity never clears any threshold for that
        // case, no matter how correct the match actually is).
        const historyMatch = await tryHistoryCorroboration(supabase, fighter, candidates, fetchOpts);
        if (historyMatch) {
          const outcome = await attemptSherdogWrite(supabase, fighter, historyMatch, checkedAt, dryRun);
          if (outcome.kind === "collision") {
            summary.collision++;
            if (dryRun) logCollision(fighter.name, historyMatch, outcome);
            if (!dryRun) await finalizeCollision(supabase, fighter, historyMatch, checkedAt, outcome);
            continue;
          }
          summary.matched++;
          summary.historyMatched++;
          if (dryRun) {
            console.log(
              `  auto-match (history)  ${fighter.name} -> #${historyMatch} (${decision.reason})`,
            );
          }
          continue;
        }
      }

      if (decision.kind === "low_confidence" && decision.reason === "below_threshold") {
        summary.queued++;
        if (dryRun) logQueued(fighter.name, "below_threshold", candidates);
        if (!dryRun) {
          await openConflict(supabase, fighter, candidates, "below_threshold");
          await markChecked(supabase, fighter.id, checkedAt);
        }
        continue;
      }

      // decision.kind === "ambiguous": two+ candidates tied on name. Try
      // the fight-count tie-break before falling back to the review queue
      // -- a regional namesake with two bouts is not on a UFC card.
      if (decision.kind === "low_confidence") {
        const tied = tiedTopCandidates(fighter.name, candidates);
        let winner: number | null = null;
        if (tied.length <= AMBIGUOUS_TIEBREAK_MAX_CANDIDATES) {
          const facts = await Promise.all(
            tied.map(async (c) => {
              const f = await pageFacts(c.sherdogId, fighter.name, fetchOpts);
              return { sherdogId: c.sherdogId, guardPassed: f.guardPassed, proFightCount: f.proFightCount };
            }),
          );
          winner = pickTiebreakWinner(facts);
        }

        if (winner === null) {
          summary.queued++;
          if (dryRun) logQueued(fighter.name, "ambiguous (tie-break inconclusive)", candidates);
          if (!dryRun) {
            await openConflict(supabase, fighter, candidates, "ambiguous");
            await markChecked(supabase, fighter.id, checkedAt);
          }
          continue;
        }

        const outcome = await attemptSherdogWrite(supabase, fighter, winner, checkedAt, dryRun);
        if (outcome.kind === "collision") {
          summary.collision++;
          if (dryRun) logCollision(fighter.name, winner, outcome);
          if (!dryRun) await finalizeCollision(supabase, fighter, winner, checkedAt, outcome);
          continue;
        }
        summary.matched++;
        if (dryRun) console.log(`  auto-match (tie-break)  ${fighter.name} -> #${winner}`);
        continue;
      }

      // decision.kind === "matched" -- second gate: the fetched page's
      // own name must still plausibly be this fighter (a wrong id returns
      // HTTP 200 for a different person).
      const facts = await pageFacts(decision.sherdogId, fighter.name, fetchOpts);
      if (!facts.guardPassed) {
        summary.guardRejected++;
        summary.queued++;
        if (dryRun) {
          console.log(
            `  guard rejected      ${fighter.name} -> page #${decision.sherdogId} is "${facts.pageName}"`,
          );
        }
        if (!dryRun) {
          await openConflict(supabase, fighter, candidates, "guard_mismatch", facts.pageName);
          await markChecked(supabase, fighter.id, checkedAt);
        }
        continue;
      }

      const outcome = await attemptSherdogWrite(supabase, fighter, decision.sherdogId, checkedAt, dryRun);
      if (outcome.kind === "collision") {
        summary.collision++;
        if (dryRun) logCollision(fighter.name, decision.sherdogId, outcome);
        if (!dryRun) await finalizeCollision(supabase, fighter, decision.sherdogId, checkedAt, outcome);
        continue;
      }
      summary.matched++;
      if (dryRun) {
        console.log(
          `  auto-match          ${fighter.name} -> #${decision.sherdogId} "${facts.pageName}" @ ${decision.confidence.toFixed(2)}`,
        );
      }
    } catch (err) {
      summary.failed++;
      console.error(`Sherdog identity failed for fighter ${fighter.id} (${fighter.name}):`, err);
    }
  }

  // A high miss rate over a non-trivial batch is the signature of a
  // broken parseSearchResults, not of that many fighters genuinely
  // missing from Sherdog. Fail loudly and leave them unmarked so they
  // retry once the parser is fixed.
  const decided = summary.attempted - summary.failed;
  if (decided >= 10 && notFound.length / decided > 0.5) {
    throw new Error(
      `Sherdog search returned nothing for ${notFound.length}/${decided} fighters -- ` +
        `refusing to mark them checked, this looks like a parseSearchResults regression.`,
    );
  }

  if (!dryRun) {
    for (const fighterId of notFound) {
      await markChecked(supabase, fighterId, now().toISOString());
    }
  }

  return summary;
}

interface PageFacts {
  pageName: string;
  guardPassed: boolean;
  proFightCount: number;
  history: SherdogHistoryFight[];
}

async function pageFacts(
  sherdogId: number,
  storedName: string,
  fetchOpts: FetchOptions,
): Promise<PageFacts> {
  const html = await fetchFighterHtmlById(sherdogId, fetchOpts);
  const pageName = parseFighterName(html) ?? "";
  const history = parseFightHistory(html);
  return {
    pageName,
    guardPassed: sherdogNameMatchesExpected(storedName, pageName),
    proFightCount: history.length,
    history,
  };
}

// M5: bounds the number of candidate-page fetches history corroboration
// will attempt for one fighter. 20 covers every real case seen live
// (David Martínez's own open conflict has exactly 20 -- Sherdog's own
// search results cap) with no margin needed beyond it; a fighter with
// MORE than 20 same-name candidates gets no history check and falls
// through to the existing behavior unchanged, same fail-safe posture as
// the pro-fight-count tie-break's own AMBIGUOUS_TIEBREAK_MAX_CANDIDATES.
const HISTORY_CORROBORATION_MAX_CANDIDATES = 20;

/**
 * M5: fetch every candidate's page (bounded, see above) and return the
 * sherdog_id of the ONE candidate whose real fight history corroborates
 * one of our fighter's own known bouts -- or null if zero or more than
 * one candidate corroborates (an actual tie between two real corroborated
 * careers is not this function's call to make; it goes to review like
 * any other unresolved ambiguity).
 *
 * Deliberately does not apply identityGuard.ts's page-name check here:
 * the whole point of this path is the case where the page's own name
 * legitimately does NOT match our stored name (a nickname we store
 * instead of the legal name Sherdog uses, or vice versa) -- that guard
 * would reject the exact fix this function exists to make.
 */
async function tryHistoryCorroboration(
  supabase: SupabaseClient,
  fighter: { id: string; name: string },
  candidates: SherdogSearchCandidate[],
  fetchOpts: FetchOptions,
): Promise<number | null> {
  if (candidates.length === 0 || candidates.length > HISTORY_CORROBORATION_MAX_CANDIDATES) return null;

  const knownBouts: KnownOpponentBout[] = await fetchKnownOpponentBouts(supabase, fighter.id);
  if (knownBouts.length === 0) return null; // nothing to corroborate against yet

  const corroborated: number[] = [];
  for (const candidate of candidates) {
    const facts = await pageFacts(candidate.sherdogId, fighter.name, fetchOpts);
    if (historyCorroborates(knownBouts, facts.history)) corroborated.push(candidate.sherdogId);
  }
  return corroborated.length === 1 ? corroborated[0] : null;
}

async function writeMatch(
  supabase: SupabaseClient,
  fighterId: string,
  sherdogId: number,
  checkedAt: string,
): Promise<void> {
  const { error } = await supabase
    .from("fighters")
    .update(buildSherdogIdentityUpdate(sherdogId, checkedAt))
    .eq("id", fighterId);
  if (error) throw error;
}

interface ClaimantFighter {
  id: string;
  name: string;
}

type SherdogWriteOutcome = { kind: "written" } | { kind: "collision"; claimant: ClaimantFighter };

async function findSherdogIdClaimant(
  supabase: SupabaseClient,
  sherdogId: number,
  excludingFighterId: string,
): Promise<ClaimantFighter | null> {
  const { data, error } = await supabase
    .from("fighters")
    .select("id, name")
    .eq("sherdog_id", sherdogId)
    .neq("id", excludingFighterId)
    .maybeSingle();
  if (error) throw error;
  return (data as ClaimantFighter | null) ?? null;
}

/**
 * P6 (ROADMAP_V2.md): fighters.sherdog_id is UNIQUE (0036). A predictive
 * read first, not just a try/catch -- it's what lets `dryRun` report a
 * collision without ever attempting a write, matching this job's own
 * "every read, every fetch, writes NOTHING" dry-run contract. The write
 * itself is still wrapped in a fallback catch for the rare TOCTOU case
 * (something else claims the id between the read above and the write) --
 * without it, that race would still fall through to the job's generic
 * catch block and be silently counted as `failed`, the exact loss this
 * function exists to close.
 */
async function attemptSherdogWrite(
  supabase: SupabaseClient,
  fighter: { id: string; name: string },
  sherdogId: number,
  checkedAt: string,
  dryRun: boolean,
): Promise<SherdogWriteOutcome> {
  const predictedClaimant = await findSherdogIdClaimant(supabase, sherdogId, fighter.id);
  if (predictedClaimant) return { kind: "collision", claimant: predictedClaimant };

  if (dryRun) return { kind: "written" };

  try {
    await writeMatch(supabase, fighter.id, sherdogId, checkedAt);
    return { kind: "written" };
  } catch (err) {
    if (!isSherdogIdCollisionError(err)) throw err;
    const raceClaimant = await findSherdogIdClaimant(supabase, sherdogId, fighter.id);
    if (!raceClaimant) throw err; // genuinely unexplained -- surface the original error
    return { kind: "collision", claimant: raceClaimant };
  }
}

function logCollision(
  name: string,
  sherdogId: number,
  outcome: Extract<SherdogWriteOutcome, { kind: "collision" }>,
): void {
  console.log(
    `  sherdog id collision  ${name} -> #${sherdogId} already claimed by ` +
      `"${outcome.claimant.name}" (${outcome.claimant.id})`,
  );
}

async function finalizeCollision(
  supabase: SupabaseClient,
  fighter: { id: string; name: string },
  sherdogId: number,
  checkedAt: string,
  outcome: Extract<SherdogWriteOutcome, { kind: "collision" }>,
): Promise<void> {
  await openSherdogIdCollisionConflict(supabase, fighter, sherdogId, outcome.claimant);
  await markChecked(supabase, fighter.id, checkedAt);
}

async function openSherdogIdCollisionConflict(
  supabase: SupabaseClient,
  fighter: { id: string; name: string },
  sherdogId: number,
  claimant: ClaimantFighter,
): Promise<void> {
  // Same "don't stack a second row" guard openConflict below already uses.
  const { data: existing, error: existingError } = await supabase
    .from("data_conflicts")
    .select("id")
    .eq("kind", "sherdog_id_collision")
    .is("resolved_at", null)
    .eq("details->>fighterId", fighter.id)
    .limit(1);
  if (existingError) throw existingError;
  if (existing && existing.length > 0) return;

  const { error } = await supabase
    .from("data_conflicts")
    .insert(buildSherdogIdCollisionInsert(fighter.id, fighter.name, sherdogId, claimant.id, claimant.name));
  if (error) throw error;
}

function logQueued(
  name: string,
  label: string,
  candidates: Awaited<ReturnType<typeof searchSherdogFighters>>,
): void {
  const ranked = rankSherdogCandidates(name, candidates);
  console.log(
    `  review queue (${label})  ${name} -> best "${ranked[0]?.name}" ` +
      `#${ranked[0]?.sherdogId} @ ${ranked[0]?.confidence.toFixed(2)} (${candidates.length} candidates)`,
  );
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
  reason: "below_threshold" | "ambiguous" | "guard_mismatch",
  guardMismatchPageName?: string,
): Promise<void> {
  // Don't stack a second row for a fighter that already has an open one
  // (a prior run that inserted the conflict but then failed before
  // marking the fighter checked). `fighterId` lives in the JSON details.
  const { data: existing, error: existingError } = await supabase
    .from("data_conflicts")
    .select("id")
    .eq("kind", "low_confidence_sherdog_match")
    .is("resolved_at", null)
    .eq("details->>fighterId", fighter.id)
    .limit(1);
  if (existingError) throw existingError;
  if (existing && existing.length > 0) return;

  const ranked = rankSherdogCandidates(fighter.name, candidates);
  const { error } = await supabase
    .from("data_conflicts")
    .insert(buildSherdogConflictInsert(fighter.id, fighter.name, ranked, candidates, reason, guardMismatchPageName));
  if (error) throw error;
}
