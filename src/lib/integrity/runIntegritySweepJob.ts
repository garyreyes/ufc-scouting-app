import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllPages } from "../supabase/selectAllPages";
import { selectAllPagesByIds } from "../supabase/selectAllPagesByIds";
import { fetchEligibleUnpricedFights, fetchPricedFightIds } from "../odds/eligibleUnpricedFights";
import { selectStaleLowConfidenceConflictIds } from "../odds/selectStaleLowConfidenceConflicts";
import { getOpenDisputedFightIds } from "../../features/conflicts/api";
import { detectStructuralDuplicateFighters, type FighterForDupeCheck } from "./detectStructuralDuplicateFighters";
import { buildStructuralDuplicateInsert } from "./buildStructuralDuplicateInsert";
import { detectMissingSherdogChecks } from "./detectMissingSherdogChecks";
import { detectUnpricedUnconflictedFights } from "./detectUnpricedUnconflictedFights";
import { detectStaleConflicts } from "./detectStaleConflicts";
import { detectDuplicateOddsConflicts } from "./detectDuplicateOddsConflicts";

export interface IntegritySweepSummary {
  structuralDuplicatesOpened: number;
  missingSherdogChecksOpened: number;
  missingSherdogChecksClosed: number;
  unpricedUnconflictedOpened: number;
  unpricedUnconflictedClosed: number;
  staleConflictsOpened: number;
  staleConflictsClosed: number;
  duplicateOddsConflictsClosed: number;
  staleLowConfidenceClosed: number; // I4
}

interface OpenLowConfidenceRow {
  id: string;
  details: { candidateFightId?: string | null };
  detected_at: string;
}

/**
 * P8 (ROADMAP_V2.md Phase P, Tier 3): the standing verification this
 * project has never had. Six invariants, three shapes of response --
 * I1 is a real owner judgment call (opens a data_conflicts row, same
 * merge-review pattern as sherdog_id_collision); I4/I6 are mechanical
 * (auto-remediated directly, no row for a human to look at); I2/I3/I5
 * are visibility-only (a lightweight integrity_alerts row that opens and
 * self-closes with no resolve action, since there's nothing to decide).
 *
 * Every whole-table read goes through selectAllPages/selectAllPagesByIds
 * -- fighters and fights have already silently crossed PostgREST's row
 * cap once (M1, PROJECT_FACTS.md), and this job reads both in full.
 */
export async function runIntegritySweep(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<IntegritySweepSummary> {
  const summary: IntegritySweepSummary = {
    structuralDuplicatesOpened: 0,
    missingSherdogChecksOpened: 0,
    missingSherdogChecksClosed: 0,
    unpricedUnconflictedOpened: 0,
    unpricedUnconflictedClosed: 0,
    staleConflictsOpened: 0,
    staleConflictsClosed: 0,
    duplicateOddsConflictsClosed: 0,
    staleLowConfidenceClosed: 0,
  };

  // ---- I1: structural duplicate fighters (data_conflicts, owner review) ----
  const fighters = await selectAllPages<{ id: string; name: string; sherdog_checked_at: string | null }>(
    supabase,
    "fighters",
    "id, name, sherdog_checked_at",
  );
  const duplicatePairs = detectStructuralDuplicateFighters(
    fighters.map((f): FighterForDupeCheck => ({ id: f.id, name: f.name })),
  );
  for (const pair of duplicatePairs) {
    const opened = await openStructuralDuplicateConflict(supabase, pair);
    if (opened) summary.structuralDuplicatesOpened++;
  }

  // ---- I2: missing Sherdog check on an upcoming-card fighter (alert) ----
  const today = now.toISOString().slice(0, 10);
  const upcomingEvents = await selectAllPages<{ id: string }>(supabase, "events", "id", (q) =>
    q.gte("event_date", today),
  );
  const upcomingFights = await selectAllPagesByIds<{ id: string; fighter1_id: string; fighter2_id: string }>(
    supabase,
    "fights",
    "id, fighter1_id, fighter2_id",
    "event_id",
    upcomingEvents.map((e) => e.id),
  );
  const upcomingCardFighterIds = new Set(upcomingFights.flatMap((f) => [f.fighter1_id, f.fighter2_id]));

  const missingCheckIds = detectMissingSherdogChecks(
    upcomingCardFighterIds,
    fighters.map((f) => ({ id: f.id, sherdogCheckedAt: f.sherdog_checked_at })),
  );
  const i2 = await diffAlerts(supabase, "I2", missingCheckIds, (fighterId) => ({ fighterId }), now);
  summary.missingSherdogChecksOpened = i2.opened;
  summary.missingSherdogChecksClosed = i2.closed;

  // ---- shared read: every OPEN low_confidence_odds_match row (I3/I4/I6) ----
  const openLowConfidenceRows = await selectAllPages<OpenLowConfidenceRow>(
    supabase,
    "data_conflicts",
    "id, details, detected_at",
    (q) => q.eq("kind", "low_confidence_odds_match").is("resolved_at", null),
  );
  const openLowConfidenceCandidateFightIds = new Set(
    openLowConfidenceRows
      .map((r) => r.details.candidateFightId)
      .filter((id): id is string => Boolean(id)),
  );

  // ---- I3: unpriced + unconflicted near/past T-12h (alert) ----
  const eligibleUnpriced = await fetchEligibleUnpricedFights(supabase, now);
  const disputedFightIds = await getOpenDisputedFightIds(eligibleUnpriced.map((f) => f.id));
  const unpricedUnconflictedIds = detectUnpricedUnconflictedFights(
    eligibleUnpriced,
    disputedFightIds,
    openLowConfidenceCandidateFightIds,
  );
  const i3 = await diffAlerts(supabase, "I3", unpricedUnconflictedIds, (fightId) => ({ fightId }), now);
  summary.unpricedUnconflictedOpened = i3.opened;
  summary.unpricedUnconflictedClosed = i3.closed;

  // ---- I4: stale low_confidence_odds_match already priced (auto-close) ----
  const pricedFightIds = await fetchPricedFightIds(supabase);
  const staleLowConfidenceIds = selectStaleLowConfidenceConflictIds(openLowConfidenceRows, pricedFightIds);
  if (staleLowConfidenceIds.length > 0) {
    const { error } = await supabase
      .from("data_conflicts")
      .update({ resolved_at: now.toISOString(), resolution: "fight_priced_elsewhere" })
      .in("id", staleLowConfidenceIds);
    if (error) throw error;
    summary.staleLowConfidenceClosed = staleLowConfidenceIds.length;
  }

  // ---- I6: duplicate open low_confidence_odds_match for the same fight (auto-close) ----
  // Excludes anything I4 already closed above -- a row can't need closing twice.
  const alreadyClosedThisRun = new Set(staleLowConfidenceIds);
  const duplicateIds = detectDuplicateOddsConflicts(
    openLowConfidenceRows
      .filter((r) => !alreadyClosedThisRun.has(r.id))
      .map((r) => ({ id: r.id, candidateFightId: r.details.candidateFightId ?? null, detectedAt: r.detected_at })),
  );
  if (duplicateIds.length > 0) {
    const { error } = await supabase
      .from("data_conflicts")
      .update({ resolved_at: now.toISOString(), resolution: "duplicate_conflict" })
      .in("id", duplicateIds);
    if (error) throw error;
    summary.duplicateOddsConflictsClosed = duplicateIds.length;
  }

  // ---- I5: conflict open longer than the review-staleness window (alert) ----
  const openConflicts = await selectAllPages<{ id: string; detected_at: string }>(
    supabase,
    "data_conflicts",
    "id, detected_at",
    (q) => q.is("resolved_at", null),
  );
  const staleConflictIds = detectStaleConflicts(
    openConflicts.map((c) => ({ id: c.id, detectedAt: c.detected_at })),
    now,
  );
  const i5 = await diffAlerts(supabase, "I5", staleConflictIds, (conflictId) => ({ conflictId }), now);
  summary.staleConflictsOpened = i5.opened;
  summary.staleConflictsClosed = i5.closed;

  return summary;
}

/**
 * I1's "don't stack a duplicate row for the same pair" guard -- checks
 * for ANY existing row for this pair, open OR resolved, not just open
 * ones (reviewer finding: I1 re-scans the WHOLE fighters table every run,
 * so an open-only guard let an owner's "not_same_person" verdict get
 * silently re-asked forever -- the very next sweep would find the exact
 * same names again, see no OPEN row, and reopen it). A merge resolution
 * doesn't need special-casing here either: once merged, one side of the
 * pair no longer exists in `fighters`, so this pair simply stops being
 * generated by detectStructuralDuplicateFighters on future runs.
 */
async function openStructuralDuplicateConflict(
  supabase: SupabaseClient,
  pair: { fighterAId: string; fighterAName: string; fighterBId: string; fighterBName: string },
): Promise<boolean> {
  const { data: existing, error: existingError } = await supabase
    .from("data_conflicts")
    .select("id")
    .eq("kind", "structural_duplicate_fighters")
    .eq("details->>fighterAId", pair.fighterAId)
    .eq("details->>fighterBId", pair.fighterBId)
    .limit(1);
  if (existingError) throw existingError;
  if (existing && existing.length > 0) return false;

  const { error } = await supabase.from("data_conflicts").insert(buildStructuralDuplicateInsert(pair));
  if (error) throw error;
  return true;
}

interface AlertDiffResult {
  opened: number;
  closed: number;
}

/**
 * The shared open/close diff for I2/I3/I5: open a new integrity_alerts
 * row for every currently-violating key that isn't already open, and
 * close (resolved_at = now) every open row whose key is no longer
 * violating -- this is what makes an alert self-heal with no separate
 * "resolve" action needed, since there's nothing for an owner to decide
 * here. Reads via selectAllPages, not a raw .select() -- reviewer finding:
 * an unpaged read here would silently under-count `openByKey` past
 * PostgREST's row cap, which doesn't just miss a close, it also causes a
 * duplicate open-insert attempt for a key PostgREST truncated out of this
 * read, colliding with 0063's partial unique index.
 */
async function diffAlerts(
  supabase: SupabaseClient,
  invariant: "I2" | "I3" | "I5",
  currentKeys: string[],
  detailsFor: (key: string) => Record<string, unknown>,
  now: Date,
): Promise<AlertDiffResult> {
  const openRows = await selectAllPages<{ id: string; dedupe_key: string }>(
    supabase,
    "integrity_alerts",
    "id, dedupe_key",
    (q) => q.eq("invariant", invariant).is("resolved_at", null),
  );

  const openByKey = new Map(openRows.map((r) => [r.dedupe_key, r.id]));
  const currentSet = new Set(currentKeys);

  let opened = 0;
  for (const key of currentKeys) {
    if (openByKey.has(key)) continue;
    const { error: insertError } = await supabase
      .from("integrity_alerts")
      .insert({ invariant, dedupe_key: key, details: detailsFor(key) });
    if (insertError) throw insertError;
    opened++;
  }

  const toCloseIds = [...openByKey.entries()].filter(([key]) => !currentSet.has(key)).map(([, id]) => id);
  let closed = 0;
  if (toCloseIds.length > 0) {
    const { error: closeError } = await supabase
      .from("integrity_alerts")
      .update({ resolved_at: now.toISOString() })
      .in("id", toCloseIds);
    if (closeError) throw closeError;
    closed = toCloseIds.length;
  }

  return { opened, closed };
}
