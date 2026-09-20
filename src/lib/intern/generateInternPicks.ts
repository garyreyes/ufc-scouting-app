import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_RATING } from "../elo/eloMath";
import { fetchNearestUpcomingEventId } from "../events/nearestUpcomingEvent";
import { fetchLatestEloRatings } from "../elo/fetchLatestEloRatings";
import { fetchFlagsForFights } from "../rumours/fetchFlagsForFights";
import { applyUnderdogFloor } from "./applyUnderdogFloor";
import type { FloorInput } from "./applyUnderdogFloor";
import { decideInternBet } from "./decideInternBet";
import { decideInternPick } from "./decideInternPick";
import { finishSplitFrom, predictInternMethod } from "./predictInternMethod";
import type { InternMethodDecision } from "./predictInternMethod";
import { segmentCard } from "./segmentCard";
import type { InternFlag, InternPickSignals } from "./types";
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
  bout_order: number | null;
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
  signals: InternPickSignals | null;
}

// L4-fix (found live 2026-09-13, fixed 2026-09-19): this codebase never
// calls `.throwOnError()` on a Supabase query, so a failed `.upsert()`
// throws PostgREST's own plain `{ message, code, details, hint }` object,
// never a real `Error` instance -- `err instanceof Error` was always
// false here, so every upsert failure (locked or not) fell through to
// `String(err)` ("[object Object]"), which can never contain "Picks are
// locked". Reading `.message` off any object that has one (not just a
// real Error) is what actually matches the real failure shape.
export function isLockedError(err: unknown): boolean {
  const message =
    typeof err === "object" && err !== null && "message" in err ? String(err.message) : String(err);
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
 *
 * Two-phase (user-confirmed 2026-09-21): every fight's honest pick/bet is
 * decided first, with nothing written yet, so applyUnderdogFloor.ts can
 * see the WHOLE card's picks and bets before deciding whether either
 * segment (main card / prelims) needs a forced underdog pick or bet --
 * real UFC cards almost never sweep every favourite, and nothing in the
 * old single-fight-at-a-time loop could ever have enforced that. The
 * floor never touches decideInternPick/decideInternBet's own output --
 * see applyUnderdogFloor.ts's docstring and DECISIONS.md (2026-09-21).
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

  // M2: `.is("settled_at", null)` excludes a cancelled bout -- without it,
  // a fight pulled from the nearest upcoming card (still "upcoming" by
  // date even after cancellation) would get a full pick written on a
  // fight that will never happen.
  const { data: rawFights, error: fightsError } = await supabase
    .from("fights")
    .select(
      "id, weight_class, bout_order, " +
        "fighter1:fighter1_id(id, name, reach_cm, height_cm, birth_date, sherdog_wins_by_ko, sherdog_wins_by_sub, sherdog_wins_by_dec, sherdog_losses_by_ko, sherdog_losses_by_sub, sherdog_losses_by_dec), " +
        "fighter2:fighter2_id(id, name, reach_cm, height_cm, birth_date, sherdog_wins_by_ko, sherdog_wins_by_sub, sherdog_wins_by_dec, sherdog_losses_by_ko, sherdog_losses_by_sub, sherdog_losses_by_dec)",
    )
    .eq("event_id", eventId)
    .is("settled_at", null);
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

  // Phase A: decide every fight's honest pick/bet, nothing written yet --
  // applyUnderdogFloor.ts needs the whole card's picks and bets in hand
  // before it can tell whether a segment swept every favourite.
  const considered: {
    fight: EmbeddedFight;
    decision: ReturnType<typeof decideInternPick>;
    bet: ReturnType<typeof decideInternBet>;
    odds: { fighter1Price: number; fighter2Price: number } | null;
  }[] = [];

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
    // one each). Deliberately computed on the ORIGINAL (pre-floor)
    // pick -- the floor never invents a bet INTERN wouldn't otherwise
    // place (user-confirmed 2026-09-21), so this must reflect the
    // intern's real edge read, not a forced pick.
    const bet = decideInternBet(
      fight.fighter1.id,
      fight.fighter2.id,
      decision.predictedFighterId,
      decision.estimatedProbability,
      decision.confidence,
      odds,
    );

    considered.push({ fight, decision, bet, odds });
  }

  // Card-sweep floor (DECISIONS.md 2026-09-21): guarantee at least one
  // underdog pick, and separately one underdog bet among bets already
  // placed, per segment (main card / prelims).
  const segmented = segmentCard(considered.map((c) => ({ fightId: c.fight.id, boutOrder: c.fight.bout_order })));
  const segmentByFightId = new Map(segmented.map((s) => [s.fightId, s.segment]));

  const floorInputs: FloorInput[] = considered.map((c) => ({
    fightId: c.fight.id,
    segment: segmentByFightId.get(c.fight.id)!,
    fighter1Id: c.fight.fighter1.id,
    fighter2Id: c.fight.fighter2.id,
    odds: c.odds,
    pick: {
      predictedFighterId: c.decision.predictedFighterId,
      estimatedProbability: c.decision.estimatedProbability,
      confidence: c.decision.confidence,
    },
    bet: { betFighterId: c.bet.betFighterId, stakeUnits: c.bet.stakeUnits },
  }));
  const floorByFightId = new Map(applyUnderdogFloor(floorInputs).map((r) => [r.fightId, r]));

  // Phase B: write the final (possibly floor-overridden) pick/bet.
  for (const { fight, decision, bet } of considered) {
    const final = floorByFightId.get(fight.id)!;

    // A third judgment alongside the pick and the bet -- how the fight
    // ends. Deterministic: the picked fighter's own Sherdog win split vs
    // the opponent's own loss split when both exist (L5), falling back to
    // base-rate + lopsidedness + weight class when either side has no
    // Sherdog history (predictInternMethod.ts). Uses the FINAL picked
    // fighter -- if the floor forced an underdog pick, the method call
    // must be about who INTERN is actually picking now, not its
    // pre-floor read.
    const pickedIsFighter1 = final.pick.predictedFighterId === fight.fighter1.id;
    const pickedFighter = pickedIsFighter1 ? fight.fighter1 : fight.fighter2;
    const opponentFighter = pickedIsFighter1 ? fight.fighter2 : fight.fighter1;
    const method = predictInternMethod(
      final.pick.estimatedProbability,
      fight.weight_class,
      finishSplitFrom(pickedFighter),
      finishSplitFrom(opponentFighter),
    );

    let reasoning = `${decision.reasoning} ${bet.note} ${method.note}`;
    if (final.pick.overridden) {
      reasoning += " Card-sweep rule: forced underdog pick -- this segment would otherwise sweep favourites.";
    }
    if (final.bet.overridden) {
      reasoning += " Card-sweep rule: redirected an existing bet onto the underdog for the same reason.";
    }

    const existing = existingByFightId.get(fight.id);
    if (existing && isUnchanged(existing, final, method, decision.signals, reasoning)) {
      summary.picksUnchanged++;
      continue;
    }

    try {
      const { error } = await supabase.from("picks").upsert(
        {
          fight_id: fight.id,
          author: "INTERN",
          user_id: null,
          predicted_fighter_id: final.pick.predictedFighterId,
          estimated_probability: final.pick.estimatedProbability,
          confidence: final.pick.confidence,
          reasoning,
          predicted_method: method.method,
          bet_fighter_id: final.bet.betFighterId,
          stake_units: final.bet.stakeUnits,
          signals: decision.signals,
        },
        { onConflict: "fight_id,author" },
      );
      if (error) throw error;
      summary.picksWritten++;
      // L4-fix: counted here, after a confirmed successful write, not
      // unconditionally right after decideInternBet -- a locked/failed
      // upsert must never inflate this count with a bet that was never
      // actually placed.
      if (final.bet.betFighterId !== null) summary.betsPlaced++;
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
  final: {
    pick: { predictedFighterId: string; estimatedProbability: number; confidence: number };
    bet: { betFighterId: string | null; stakeUnits: number | null };
  },
  method: InternMethodDecision,
  signals: InternPickSignals,
  reasoning: string,
): boolean {
  return (
    existing.predictedFighterId === final.pick.predictedFighterId &&
    // numeric(5,4) round-trips to 4 decimal places, so compare at that
    // precision rather than by exact float equality.
    Math.abs(existing.estimatedProbability - final.pick.estimatedProbability) < 0.00005 &&
    existing.confidence === final.pick.confidence &&
    existing.reasoning === reasoning &&
    existing.predictedMethod === method.method &&
    existing.betFighterId === final.bet.betFighterId &&
    // numeric(6,2) -- same precision reasoning as estimated_probability
    // above. Both null is the "no bet, still no bet" case.
    (existing.stakeUnits === null && final.bet.stakeUnits === null
      ? true
      : existing.stakeUnits !== null &&
        final.bet.stakeUnits !== null &&
        Math.abs(existing.stakeUnits - final.bet.stakeUnits) < 0.005) &&
    // N5: existing.signals is null for every pick written before this
    // migration -- treated as "changed" so a re-run backfills it once,
    // same as any other genuinely new value.
    existing.signals !== null &&
    signalsEqual(existing.signals, signals)
  );
}

function signalsEqual(a: InternPickSignals, b: InternPickSignals): boolean {
  return (
    Math.abs(a.rumours - b.rumours) < 1e-9 &&
    Math.abs(a.elo - b.elo) < 1e-9 &&
    Math.abs(a.size - b.size) < 1e-9 &&
    Math.abs(a.age - b.age) < 1e-9 &&
    Math.abs(a.rawDelta - b.rawDelta) < 1e-9 &&
    Math.abs(a.clampedDelta - b.clampedDelta) < 1e-9
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
      "fight_id, predicted_fighter_id, estimated_probability, confidence, reasoning, predicted_method, bet_fighter_id, stake_units, signals",
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
        signals: row.signals as InternPickSignals | null,
      },
    ]),
  );
}
