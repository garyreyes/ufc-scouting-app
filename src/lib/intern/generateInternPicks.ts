import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchFlagsForFights } from "../rumours/fetchFlagsForFights";
import { decideInternPick } from "./decideInternPick";
import type { InternFlag, InternPickDecision } from "./types";

export interface InternPicksSummary {
  fightsConsidered: number;
  picksWritten: number;
  picksUnchanged: number;
  unpricedPicks: number;
  skippedConflict: number;
  skippedLocked: number;
  failed: number;
}

interface EmbeddedFight {
  id: string;
  fighter1: { id: string; name: string };
  fighter2: { id: string; name: string };
}

interface ExistingPick {
  fightId: string;
  predictedFighterId: string;
  estimatedProbability: number;
  confidence: number;
  reasoning: string | null;
}

function isLockedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("Picks are locked");
}

/**
 * G1: one INTERN pick per upcoming fight -- market-anchored where a price
 * exists, rumour-adjusted, deterministic (decideInternPick.ts).
 *
 * Scoped to every UPCOMING event, not just the nearest: unlike the rumour
 * job there is no per-fight external API cost here, and the intern is
 * meant to have an opinion on every fight. A fight three weeks out with
 * no price yet simply gets an unanchored pick now and a better one later,
 * which is exactly what "revise until the card locks" (user-confirmed
 * 2026-09-02) is for.
 *
 * Writes only when the decision actually CHANGED. Rewriting identical
 * values every run would leave picks.updated_at meaningless, and
 * updated_at is the only record of when the intern last changed its mind
 * -- worth keeping honest now that revision is allowed.
 *
 * A fight whose card has already started is rejected by the pick-lock
 * trigger (0027 closed the service_role bypass that would previously have
 * let this job write straight past it) -- caught per fight and counted,
 * never allowed to abort the rest of the card.
 */
export async function generateInternPicks(supabase: SupabaseClient): Promise<InternPicksSummary> {
  const summary: InternPicksSummary = {
    fightsConsidered: 0,
    picksWritten: 0,
    picksUnchanged: 0,
    unpricedPicks: 0,
    skippedConflict: 0,
    skippedLocked: 0,
    failed: 0,
  };

  const today = new Date().toISOString().slice(0, 10);

  const { data: events, error: eventsError } = await supabase
    .from("events")
    .select("id")
    .gte("event_date", today);
  if (eventsError) throw eventsError;
  const eventIds = (events ?? []).map((e) => e.id as string);
  if (eventIds.length === 0) return summary;

  const { data: rawFights, error: fightsError } = await supabase
    .from("fights")
    .select("id, fighter1:fighter1_id(id, name), fighter2:fighter2_id(id, name)")
    .in("event_id", eventIds);
  if (fightsError) throw fightsError;

  const fights = (rawFights ?? []) as unknown as EmbeddedFight[];
  if (fights.length === 0) return summary;
  const fightIds = fights.map((f) => f.id);

  // Fetched separately and merged in JS rather than embedded -- the same
  // pattern features/fights/api.ts and matchAndSnapshot.ts already use.
  const [oddsByFightId, flagsByFightId, conflictedFightIds, existingByFightId] = await Promise.all([
    fetchOdds(supabase, fightIds),
    fetchFlags(supabase, fightIds),
    fetchConflictedFightIds(supabase, fightIds),
    fetchExistingInternPicks(supabase, fightIds),
  ]);

  for (const fight of fights) {
    summary.fightsConsidered++;

    // The trigger would reject this anyway ("resolve it at /conflicts
    // first"); skipping cleanly keeps a held bout out of the failure
    // count, where it would read as a bug rather than the intended hold.
    if (conflictedFightIds.has(fight.id)) {
      summary.skippedConflict++;
      continue;
    }

    const decision = decideInternPick({
      fighter1: fight.fighter1,
      fighter2: fight.fighter2,
      odds: oddsByFightId.get(fight.id) ?? null,
      flags: flagsByFightId.get(fight.id) ?? [],
    });

    if (!decision.marketAnchored) summary.unpricedPicks++;

    const existing = existingByFightId.get(fight.id);
    if (existing && isUnchanged(existing, decision)) {
      summary.picksUnchanged++;
      continue;
    }

    try {
      const { error } = await supabase.from("picks").upsert(
        {
          fight_id: fight.id,
          author: "INTERN",
          user_id: null,
          predicted_fighter_id: decision.predictedFighterId,
          estimated_probability: decision.estimatedProbability,
          confidence: decision.confidence,
          reasoning: decision.reasoning,
        },
        { onConflict: "fight_id,author" },
      );
      if (error) throw error;
      summary.picksWritten++;
    } catch (err) {
      if (isLockedError(err)) {
        summary.skippedLocked++;
      } else {
        summary.failed++;
        console.error(`Intern pick failed for fight ${fight.id}:`, err);
      }
    }
  }

  return summary;
}

function isUnchanged(existing: ExistingPick, decision: InternPickDecision): boolean {
  return (
    existing.predictedFighterId === decision.predictedFighterId &&
    // numeric(5,4) round-trips to 4 decimal places, so compare at that
    // precision rather than by exact float equality.
    Math.abs(existing.estimatedProbability - decision.estimatedProbability) < 0.00005 &&
    existing.confidence === decision.confidence &&
    existing.reasoning === decision.reasoning
  );
}

async function fetchOdds(
  supabase: SupabaseClient,
  fightIds: string[],
): Promise<Map<string, { fighter1Price: number; fighter2Price: number }>> {
  const { data, error } = await supabase
    .from("odds_snapshots")
    .select("fight_id, fighter1_price, fighter2_price")
    .in("fight_id", fightIds);
  if (error) throw error;

  return new Map(
    (data ?? []).map((row) => [
      row.fight_id as string,
      { fighter1Price: Number(row.fighter1_price), fighter2Price: Number(row.fighter2_price) },
    ]),
  );
}

async function fetchFlags(
  supabase: SupabaseClient,
  fightIds: string[],
): Promise<Map<string, InternFlag[]>> {
  const flags = await fetchFlagsForFights(supabase, fightIds);
  const byFightId = new Map<string, InternFlag[]>();
  for (const flag of flags) {
    const list = byFightId.get(flag.fightId) ?? [];
    list.push({
      fighterId: flag.fighterId,
      category: flag.category,
      corroborationCount: flag.corroborationCount,
    });
    byFightId.set(flag.fightId, list);
  }
  return byFightId;
}

async function fetchConflictedFightIds(
  supabase: SupabaseClient,
  fightIds: string[],
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("data_conflicts")
    .select("fight_id")
    .eq("kind", "disputed_opponent")
    .is("resolved_at", null)
    .in("fight_id", fightIds);
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.fight_id as string));
}

async function fetchExistingInternPicks(
  supabase: SupabaseClient,
  fightIds: string[],
): Promise<Map<string, ExistingPick>> {
  const { data, error } = await supabase
    .from("picks")
    .select("fight_id, predicted_fighter_id, estimated_probability, confidence, reasoning")
    .eq("author", "INTERN")
    .in("fight_id", fightIds);
  if (error) throw error;

  return new Map(
    (data ?? []).map((row) => [
      row.fight_id as string,
      {
        fightId: row.fight_id as string,
        predictedFighterId: row.predicted_fighter_id as string,
        estimatedProbability: Number(row.estimated_probability),
        confidence: row.confidence as number,
        reasoning: row.reasoning as string | null,
      },
    ]),
  );
}
