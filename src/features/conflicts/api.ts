import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { rankFightMatches } from "@/lib/odds/matchFights";
import { fetchUnpricedFights } from "@/lib/odds/eligibleUnpricedFights";
import { compareProposalAgreement } from "@/lib/conflictProposals/compareProposalAgreement";
import type {
  DisputedOpponentDetails,
  DisputedResultDetails,
  LowConfidenceDetails,
  LowConfidenceFighterMatchDetails,
  LowConfidenceSherdogMatchDetails,
  SherdogIdCollisionDetails,
  StructuralDuplicateFightersDetails,
  ConflictDisplay,
} from "./types";

// data_conflicts has no client SELECT grant at all (0014_data_conflicts.sql
// -- deliberately closed by default, loosened only for the owner via the
// app layer, same pattern as B5's retryOddsJobAction). The owner gate
// itself lives in the page/actions that call these, not here -- these
// always use the admin client, so calling them without that gate is a
// bug in the caller, not something RLS will catch for you.

export async function getOpenConflictCount(): Promise<number> {
  const admin = getSupabaseAdmin();
  const { count, error } = await admin
    .from("data_conflicts")
    .select("id", { count: "exact", head: true })
    .is("resolved_at", null);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Which of the given fights currently have an open disputed_opponent
 * conflict -- what the card view (C3) needs to hold a row and disable
 * picking on it (ARCHITECTURE.md item #7). Deliberately does NOT check
 * low_confidence_odds_match rows -- those have fight_id null at the
 * source (B6) precisely so they never hold picking, only pricing.
 *
 * Caller-gated, not self-gated (matching getOpenConflictCount/
 * getOpenConflicts above): the card view only calls this for a confirmed
 * owner viewer, since a logged-out or non-owner visitor's read-only card
 * doesn't show conflict holds at all (docs/user-flows.md Flow 1's own
 * diagram only branches into the conflict check on the signed-in-owner
 * path).
 */
export async function getOpenDisputedFightIds(fightIds: string[]): Promise<Set<string>> {
  if (fightIds.length === 0) return new Set();

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("data_conflicts")
    .select("fight_id")
    .eq("kind", "disputed_opponent")
    .is("resolved_at", null)
    .in("fight_id", fightIds);
  if (error) throw error;

  return new Set((data ?? []).map((row) => row.fight_id as string));
}

interface ConflictRow {
  id: string;
  kind:
    | "disputed_opponent"
    | "low_confidence_odds_match"
    | "disputed_result"
    | "low_confidence_fighter_match"
    | "low_confidence_sherdog_match"
    | "sherdog_id_collision"
    | "structural_duplicate_fighters";
  fight_id: string | null;
  details:
    | DisputedOpponentDetails
    | LowConfidenceDetails
    | DisputedResultDetails
    | LowConfidenceFighterMatchDetails
    | LowConfidenceSherdogMatchDetails
    | SherdogIdCollisionDetails
    | StructuralDuplicateFightersDetails;
  detected_at: string;
}

export async function getOpenConflicts(): Promise<ConflictDisplay[]> {
  const admin = getSupabaseAdmin();

  const { data: rows, error } = await admin
    .from("data_conflicts")
    .select("id, kind, fight_id, details, detected_at")
    .is("resolved_at", null)
    .order("detected_at", { ascending: true });
  if (error) throw error;
  if (!rows || rows.length === 0) return [];

  const conflicts = rows as unknown as ConflictRow[];

  const disputedOpponent = conflicts.filter((c) => c.kind === "disputed_opponent");
  const lowConfidence = conflicts.filter((c) => c.kind === "low_confidence_odds_match");
  const disputedResult = conflicts.filter((c) => c.kind === "disputed_result");
  const lowConfidenceFighter = conflicts.filter((c) => c.kind === "low_confidence_fighter_match");
  const lowConfidenceSherdog = conflicts.filter((c) => c.kind === "low_confidence_sherdog_match");
  const sherdogIdCollision = conflicts.filter((c) => c.kind === "sherdog_id_collision");
  const structuralDuplicate = conflicts.filter((c) => c.kind === "structural_duplicate_fighters");

  const [
    disputedOpponentDisplays,
    lowConfidenceDisplays,
    disputedResultDisplays,
    lowConfidenceFighterDisplays,
    lowConfidenceSherdogDisplays,
    sherdogIdCollisionDisplays,
    structuralDuplicateDisplays,
  ] = await Promise.all([
    resolveDisputedDisplays(admin, disputedOpponent),
    resolveLowConfidenceDisplays(admin, lowConfidence),
    resolveDisputedResultDisplays(admin, disputedResult),
    resolveFighterMatchDisplays(lowConfidenceFighter),
    resolveSherdogMatchDisplays(admin, lowConfidenceSherdog),
    resolveSherdogIdCollisionDisplays(sherdogIdCollision),
    resolveStructuralDuplicateDisplays(structuralDuplicate),
  ]);

  // Restore detected_at order rather than the seven-group split above.
  const byId = new Map(
    [
      ...disputedOpponentDisplays,
      ...lowConfidenceDisplays,
      ...disputedResultDisplays,
      ...lowConfidenceFighterDisplays,
      ...lowConfidenceSherdogDisplays,
      ...sherdogIdCollisionDisplays,
      ...structuralDuplicateDisplays,
    ].map((d) => [d.id, d]),
  );
  return conflicts.map((c) => byId.get(c.id)).filter((d): d is ConflictDisplay => d !== undefined);
}

async function resolveDisputedDisplays(
  admin: SupabaseClient,
  rows: ConflictRow[],
): Promise<import("./types").DisputedOpponentDisplay[]> {
  if (rows.length === 0) return [];

  const keptFightIds = rows.map((r) => r.fight_id as string);
  const { data: keptFights, error: keptError } = await admin
    .from("fights")
    .select(
      "id, fighter1:fighter1_id(name), fighter2:fighter2_id(name), event:event_id(name, event_date)",
    )
    .in("id", keptFightIds);
  if (keptError) throw keptError;

  type EmbeddedKept = {
    id: string;
    fighter1: { name: string };
    fighter2: { name: string };
    event: { name: string; event_date: string };
  };
  const keptById = new Map(
    ((keptFights ?? []) as unknown as EmbeddedKept[]).map((f) => [f.id, f]),
  );

  const candidateFighterIds = rows.flatMap((r) => {
    const details = r.details as DisputedOpponentDetails;
    return [details.candidate_fighter1_id, details.candidate_fighter2_id];
  });
  const { data: candidateFighters, error: candidateError } = await admin
    .from("fighters")
    .select("id, name")
    .in("id", candidateFighterIds);
  if (candidateError) throw candidateError;
  const candidateNameById = new Map(
    (candidateFighters ?? []).map((f) => [f.id as string, f.name as string]),
  );

  return rows.flatMap((r) => {
    const kept = keptById.get(r.fight_id as string);
    if (!kept) return []; // defensive: the kept fight was deleted out from under an open conflict

    const details = r.details as DisputedOpponentDetails;
    return [
      {
        id: r.id,
        kind: "disputed_opponent" as const,
        detectedAt: r.detected_at,
        fightId: r.fight_id as string,
        eventName: kept.event.name,
        eventDate: kept.event.event_date,
        existingFighter1Name: kept.fighter1.name,
        existingFighter2Name: kept.fighter2.name,
        candidateFighter1Name: candidateNameById.get(details.candidate_fighter1_id) ?? "Unknown fighter",
        candidateFighter2Name: candidateNameById.get(details.candidate_fighter2_id) ?? "Unknown fighter",
      },
    ];
  });
}

async function resolveLowConfidenceDisplays(
  admin: SupabaseClient,
  rows: ConflictRow[],
): Promise<import("./types").LowConfidenceDisplay[]> {
  if (rows.length === 0) return [];

  // One shared pool of candidates -- rankFightMatches scopes each row to
  // its own odds event's date window, so fetching once and ranking per
  // row is correct and avoids N redundant fetches.
  const unpriced = await fetchUnpricedFights(admin);

  return rows.map((r) => {
    const details = r.details as LowConfidenceDetails;
    const ranked = rankFightMatches(details.oddsEvent, unpriced);
    const candidates = ranked.map((score) => {
      const fight = unpriced.find((f) => f.id === score.fightId);
      return {
        id: score.fightId,
        fighter1Name: fight?.fighter1Name ?? "Unknown fighter",
        fighter2Name: fight?.fighter2Name ?? "Unknown fighter",
        confidence: score.confidence,
      };
    });

    return {
      id: r.id,
      kind: "low_confidence_odds_match" as const,
      detectedAt: r.detected_at,
      confidence: details.confidence,
      oddsHomeTeam: details.oddsEvent.home_team,
      oddsAwayTeam: details.oddsEvent.away_team,
      candidates,
    };
  });
}

/**
 * The one conflict kind that needs no extra fetch to display -- I2's
 * enrichFighters.ts already snapshots the fighter's stored name and the
 * FULL ranked candidate list into `details` at detection time (same
 * "don't re-derive live" reasoning resolveDisputedResultDisplays'
 * comment documents for disputed_result), so this is a plain reshape,
 * not a query.
 */
function resolveFighterMatchDisplays(rows: ConflictRow[]): import("./types").LowConfidenceFighterMatchDisplay[] {
  return rows.map((r) => {
    const details = r.details as LowConfidenceFighterMatchDetails;
    return {
      id: r.id,
      kind: "low_confidence_fighter_match" as const,
      detectedAt: r.detected_at,
      storedName: details.storedName,
      candidates: details.candidates,
    };
  });
}

// Same plain reshape -- lib/sherdog snapshots storedName + the full
// ranked candidate list into details at detection. N4: also attaches an
// advisory LLM proposal, if one exists -- one extra query, not a query
// per row, since conflict_resolution_proposals.conflict_id is queried
// with a single .in() over every row in this batch.
async function resolveSherdogMatchDisplays(
  admin: SupabaseClient,
  rows: ConflictRow[],
): Promise<import("./types").LowConfidenceSherdogMatchDisplay[]> {
  if (rows.length === 0) return [];

  // N4: still-live proposals only -- accepted_at/rejected_at is null.
  // conflict_resolution_proposals has no client grant at all (0049), same
  // posture as data_conflicts, so this admin-client read is the ONLY way
  // to see a proposal -- matching this whole page's existing owner gate.
  const { data: proposals, error: proposalsError } = await admin
    .from("conflict_resolution_proposals")
    .select("conflict_id, proposed_action, rationale, second_opinion_action, second_opinion_rationale")
    .in(
      "conflict_id",
      rows.map((r) => r.id),
    )
    .is("accepted_at", null)
    .is("rejected_at", null);
  if (proposalsError) throw proposalsError;

  const proposalByConflictId = new Map(
    (proposals ?? []).map((p) => {
      const chosenSherdogId = (p.proposed_action as { chosenSherdogId: number | null }).chosenSherdogId;
      const secondOpinionAction = p.second_opinion_action as { chosenSherdogId: number | null } | null;
      return [
        p.conflict_id as string,
        {
          chosenSherdogId,
          rationale: p.rationale as string,
          secondOpinion: secondOpinionAction
            ? {
                chosenSherdogId: secondOpinionAction.chosenSherdogId,
                rationale: p.second_opinion_rationale as string,
                agreement: compareProposalAgreement(chosenSherdogId, secondOpinionAction.chosenSherdogId),
              }
            : null,
        },
      ];
    }),
  );

  return rows.map((r) => {
    const details = r.details as LowConfidenceSherdogMatchDetails;
    return {
      id: r.id,
      kind: "low_confidence_sherdog_match" as const,
      detectedAt: r.detected_at,
      storedName: details.storedName,
      // Older rows (written before J3's review pass) have no `reason`;
      // default to the least-alarming explanation.
      reason: details.reason ?? "below_threshold",
      ...(details.guardMismatchPageName ? { guardMismatchPageName: details.guardMismatchPageName } : {}),
      candidates: details.candidates,
      proposal: proposalByConflictId.get(r.id) ?? null,
    };
  });
}

// P6: plain reshape, same as resolveFighterMatchDisplays -- both fighters'
// names and the id itself are already snapshotted into details at
// detection (resolveSherdogIdentityJob.ts), no extra fetch needed.
function resolveSherdogIdCollisionDisplays(
  rows: ConflictRow[],
): import("./types").SherdogIdCollisionDisplay[] {
  return rows.map((r) => {
    const details = r.details as SherdogIdCollisionDetails;
    return {
      id: r.id,
      kind: "sherdog_id_collision" as const,
      detectedAt: r.detected_at,
      storedName: details.storedName,
      sherdogId: details.sherdogId,
      existingFighterId: details.existingFighterId,
      existingFighterName: details.existingFighterName,
    };
  });
}

// P8 (I1): plain reshape, same as resolveSherdogIdCollisionDisplays --
// both fighters' names are already snapshotted into details at detection
// (detectStructuralDuplicateFighters.ts via the sweep), no extra fetch
// needed.
function resolveStructuralDuplicateDisplays(
  rows: ConflictRow[],
): import("./types").StructuralDuplicateFightersDisplay[] {
  return rows.map((r) => {
    const details = r.details as StructuralDuplicateFightersDetails;
    return {
      id: r.id,
      kind: "structural_duplicate_fighters" as const,
      detectedAt: r.detected_at,
      fighterAId: details.fighterAId,
      fighterAName: details.fighterAName,
      fighterBId: details.fighterBId,
      fighterBName: details.fighterBName,
    };
  });
}

async function resolveDisputedResultDisplays(
  admin: SupabaseClient,
  rows: ConflictRow[],
): Promise<import("./types").DisputedResultDisplay[]> {
  if (rows.length === 0) return [];

  const fightIds = rows.map((r) => r.fight_id as string);
  const { data: fights, error: fightsError } = await admin
    .from("fights")
    .select(
      "id, fighter1:fighter1_id(id, name), fighter2:fighter2_id(id, name), event:event_id(name, event_date)",
    )
    .in("id", fightIds);
  if (fightsError) throw fightsError;

  type EmbeddedFight = {
    id: string;
    fighter1: { id: string; name: string };
    fighter2: { id: string; name: string };
    event: { name: string; event_date: string };
  };
  const fightById = new Map(((fights ?? []) as unknown as EmbeddedFight[]).map((f) => [f.id, f]));

  return rows.flatMap((r) => {
    const fight = fightById.get(r.fight_id as string);
    if (!fight) return []; // defensive: the fight was deleted out from under an open conflict

    const details = r.details as DisputedResultDetails;
    const nameForWinner = (winnerId: string | null): string | null => {
      if (winnerId === null) return null;
      if (winnerId === fight.fighter1.id) return fight.fighter1.name;
      if (winnerId === fight.fighter2.id) return fight.fighter2.name;
      return "Unknown fighter";
    };

    return [
      {
        id: r.id,
        kind: "disputed_result" as const,
        detectedAt: r.detected_at,
        fightId: r.fight_id as string,
        eventName: fight.event.name,
        eventDate: fight.event.event_date,
        fighter1Name: fight.fighter1.name,
        fighter2Name: fight.fighter2.name,
        wikipediaWinnerName: nameForWinner(details.wikipedia_winner_id),
        wikipediaMethod: details.wikipedia_method,
        wikipediaRound: details.wikipedia_round,
        apiSportsWinnerName: nameForWinner(details.api_sports_winner_id),
      },
    ];
  });
}
