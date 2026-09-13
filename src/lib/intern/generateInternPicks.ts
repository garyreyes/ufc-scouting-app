import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_RATING } from "../elo/eloMath";
import { fetchNearestUpcomingEventId } from "../events/nearestUpcomingEvent";
import { fetchLatestEloRatings } from "../elo/fetchLatestEloRatings";
import { fetchFlagsForFights } from "../rumours/fetchFlagsForFights";
import { decideInternBet } from "./decideInternBet";
import type { InternBetDecision } from "./decideInternBet";
import { decideInternPick } from "./decideInternPick";
import { finishSplitFrom, predictInternMethod } from "./predictInternMethod";
import type { InternMethodDecision } from "./predictInternMethod";
import type { InternFlag, InternPickDecision } from "./types";
import { ageOnDate } from "../../shared/utils/ageOnDate";

export interface InternPicksSummary {
  fightsConsidered: number;
  picksWritten: number;
  picksUnchanged: number;
  unpricedPicks: number;
  betsPlaced: number;
  skippedConflict: number;
  skippedLocked: number;
  failed: number;
}

interface EmbeddedFighter {
  id: string;
  name: string;
  reach_cm: number | null;
  height_cm: number | null;
  birth_date: string | null;
  sherdog_wins_by_ko: number | null;
  sherdog_wins_by_sub: number | null;
  sherdog_wins_by_dec: number | null;
  sherdog_losses_by_ko: number | null;
  sherdog_losses_by_sub: number | null;
  sherdog_losses_by_dec: number | null;
}

interface EmbeddedFight {
  id: string;
  weight_class: string | null;
  fighter1: EmbeddedFighter;
  fighter2: EmbeddedFighter;
}

interface ExistingPick {
  fightId: string;
  predictedFighterId: string;
  estimatedProbability: number;
  confidence: number;
  reasoning: string | null;
  predictedMethod: string | null;
  betFighterId: string | null;
  stakeUnits: number | null;
}

function isLockedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("Picks are locked");
}

/**
 * G1: one INTERN pick per upcoming fight -- market-anchored where a price
 * exists, rumour-adjusted, Elo-adjusted (G1-follow-up), deterministic
 * (decideInternPick.ts).
 *
 * Scoped to the SINGLE nearest upcoming card (Phase L1), the same
 * definition the rumour scan uses (fetchNearestUpcomingEventId). G1
 * originally picked every future event on the theory that "revise until
 * the card locks" made an early pick harmless -- but in practice a card
 * weeks out has no odds (nothing prices before ~T-12h), no rumour scan
 * (that job is already nearest-card-only), and an unsettled roster, so
 * those picks were a flat 50% market anchor nudged only by Elo: noise
 * that cluttered every later card's view. The intern now forms an
 * opinion only once a card is actually next up.
 *
 * Picks already written on a past card are left untouched -- they still
 * need to settle. Only the forward horizon narrowed.
 *
 * Writes only when the decision actually CHANGED. Rewriting identical
 * values every run would leave picks.updated_at meaningless, and
 * updated_at is the only record of when the intern last changed its mind
 * -- worth keeping honest now that revision is allowed.
 *
 * A fight whose card is within the intern's own lock window (T-6h before
 * starts_at, narrower than the owner's T-1h -- Phase L4,
 * lib/picks/pickLockOffsets.ts) is rejected by the pick-lock trigger (0027
 * closed the service_role bypass that would previously have let this job
 * write straight past it) -- caught per fight and counted, never allowed
 * to abort the rest of the card.
 */
export async function generateInternPicks(supabase: SupabaseClient): Promise<InternPicksSummary> {
  const summary: InternPicksSummary = {
    fightsConsidered: 0,
    picksWritten: 0,
    picksUnchanged: 0,
    unpricedPicks: 0,
    betsPlaced: 0,
    skippedConflict: 0,
    skippedLocked: 0,
    failed: 0,
  };

  const eventId = await fetchNearestUpcomingEventId(supabase);
  if (eventId === null) return summary;

  // L3-age: ages are measured on the card's own date, not "today", so the
  // same fight always produces the same inputs.
  const { data: eventRow, error: eventError } = await supabase
    .from("events")
    .select("event_date")
    .eq("id", eventId)
    .single();
  if (eventError) throw eventError;
  const cardDate = eventRow.event_date as string;
  const ageOnCard = (birthDate: string | null) => (birthDate === null ? null : ageOnDate(birthDate, cardDate));

  const { data: rawFights, error: fightsError } = await supabase
    .from("fights")
    .select(
      "id, weight_class, " +
        "fighter1:fighter1_id(id, name, reach_cm, height_cm, birth_date, sherdog_wins_by_ko, sherdog_wins_by_sub, sherdog_wins_by_dec, sherdog_losses_by_ko, sherdog_losses_by_sub, sherdog_losses_by_dec), " +
        "fighter2:fighter2_id(id, name, reach_cm, height_cm, birth_date, sherdog_wins_by_ko, sherdog_wins_by_sub, sherdog_wins_by_dec, sherdog_losses_by_ko, sherdog_losses_by_sub, sherdog_losses_by_dec)",
    )
    .eq("event_id", eventId);
  if (fightsError) throw fightsError;

  const fights = (rawFights ?? []) as unknown as EmbeddedFight[];
  if (fights.length === 0) return summary;
  const fightIds = fights.map((f) => f.id);
  const fighterIds = [...new Set(fights.flatMap((f) => [f.fighter1.id, f.fighter2.id]))];

  // Fetched separately and merged in JS rather than embedded -- the same
  // pattern features/fights/api.ts and matchAndSnapshot.ts already use.
  const [oddsByFightId, flagsByFightId, conflictedFightIds, existingByFightId, eloByFighterId] =
    await Promise.all([
      fetchOdds(supabase, fightIds),
      fetchFlags(supabase, fightIds),
      fetchConflictedFightIds(supabase, fightIds),
      fetchExistingInternPicks(supabase, fightIds),
      fetchLatestEloRatings(supabase, fighterIds),
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

    const elo1 = eloByFighterId.get(fight.fighter1.id) ?? { rating: DEFAULT_RATING, ratedFightCount: 0 };
    const elo2 = eloByFighterId.get(fight.fighter2.id) ?? { rating: DEFAULT_RATING, ratedFightCount: 0 };

    const odds = oddsByFightId.get(fight.id) ?? null;

    const decision = decideInternPick({
      fighter1: {
        id: fight.fighter1.id,
        name: fight.fighter1.name,
        eloRating: elo1.rating,
        ratedFightCount: elo1.ratedFightCount,
        reachCm: fight.fighter1.reach_cm,
        heightCm: fight.fighter1.height_cm,
        ageYears: ageOnCard(fight.fighter1.birth_date),
      },
      fighter2: {
        id: fight.fighter2.id,
        name: fight.fighter2.name,
        eloRating: elo2.rating,
        ratedFightCount: elo2.ratedFightCount,
        reachCm: fight.fighter2.reach_cm,
        heightCm: fight.fighter2.height_cm,
        ageYears: ageOnCard(fight.fighter2.birth_date),
      },
      odds,
      flags: flagsByFightId.get(fight.id) ?? [],
    });

    if (!decision.marketAnchored) summary.unpricedPicks++;

    // UC-2's own rule -- pick and bet are two different judgments,
    // decided by two separate functions, only combined here at the I/O
    // layer for storage (0019_picks.sql has one reasoning column, not
    // one each).
    const bet = decideInternBet(
      fight.fighter1.id,
      fight.fighter2.id,
      decision.predictedFighterId,
      decision.estimatedProbability,
      decision.confidence,
      odds,
    );
    if (bet.betFighterId !== null) summary.betsPlaced++;

    // A third judgment alongside the pick and the bet -- how the fight
    // ends. Deterministic: the picked fighter's own Sherdog win split vs
    // the opponent's own loss split when both exist (L5), falling back to
    // base-rate + lopsidedness + weight class when either side has no
    // Sherdog history (predictInternMethod.ts).
    const pickedIsFighter1 = decision.predictedFighterId === fight.fighter1.id;
    const pickedFighter = pickedIsFighter1 ? fight.fighter1 : fight.fighter2;
    const opponentFighter = pickedIsFighter1 ? fight.fighter2 : fight.fighter1;
    const method = predictInternMethod(
      decision.estimatedProbability,
      fight.weight_class,
      finishSplitFrom(pickedFighter),
      finishSplitFrom(opponentFighter),
    );

    const reasoning = `${decision.reasoning} ${bet.note} ${method.note}`;

    const existing = existingByFightId.get(fight.id);
    if (existing && isUnchanged(existing, decision, bet, method, reasoning)) {
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
          reasoning,
          predicted_method: method.method,
          bet_fighter_id: bet.betFighterId,
          stake_units: bet.stakeUnits,
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

function isUnchanged(
  existing: ExistingPick,
  decision: InternPickDecision,
  bet: InternBetDecision,
  method: InternMethodDecision,
  reasoning: string,
): boolean {
  return (
    existing.predictedFighterId === decision.predictedFighterId &&
    // numeric(5,4) round-trips to 4 decimal places, so compare at that
    // precision rather than by exact float equality.
    Math.abs(existing.estimatedProbability - decision.estimatedProbability) < 0.00005 &&
    existing.confidence === decision.confidence &&
    existing.reasoning === reasoning &&
    existing.predictedMethod === method.method &&
    existing.betFighterId === bet.betFighterId &&
    // numeric(6,2) -- same precision reasoning as estimated_probability
    // above. Both null is the "no bet, still no bet" case.
    (existing.stakeUnits === null && bet.stakeUnits === null
      ? true
      : existing.stakeUnits !== null &&
        bet.stakeUnits !== null &&
        Math.abs(existing.stakeUnits - bet.stakeUnits) < 0.005)
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
    .select(
      "fight_id, predicted_fighter_id, estimated_probability, confidence, reasoning, predicted_method, bet_fighter_id, stake_units",
    )
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
        predictedMethod: row.predicted_method as string | null,
        betFighterId: row.bet_fighter_id as string | null,
        stakeUnits: row.stake_units === null ? null : Number(row.stake_units),
      },
    ]),
  );
}
