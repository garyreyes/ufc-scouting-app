import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { rankFightMatches } from "@/lib/odds/matchFights";
import { fetchUnpricedFights } from "@/lib/odds/eligibleUnpricedFights";
import type { DisputedOpponentDetails, LowConfidenceDetails, ConflictDisplay } from "./types";

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

interface ConflictRow {
  id: string;
  kind: "disputed_opponent" | "low_confidence_odds_match";
  fight_id: string | null;
  details: DisputedOpponentDetails | LowConfidenceDetails;
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

  const disputed = conflicts.filter((c) => c.kind === "disputed_opponent");
  const lowConfidence = conflicts.filter((c) => c.kind === "low_confidence_odds_match");

  const [disputedDisplays, lowConfidenceDisplays] = await Promise.all([
    resolveDisputedDisplays(admin, disputed),
    resolveLowConfidenceDisplays(admin, lowConfidence),
  ]);

  // Restore detected_at order rather than the two-group split above.
  const byId = new Map(
    [...disputedDisplays, ...lowConfidenceDisplays].map((d) => [d.id, d]),
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
