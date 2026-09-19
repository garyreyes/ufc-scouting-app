import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllPages } from "@/lib/supabase/selectAllPages";
import { selectAllPagesByIds } from "@/lib/supabase/selectAllPagesByIds";
import { summarizePendingPicks } from "@/lib/scoring/summarizePendingPicks";
import { determineFavorite } from "@/lib/scoring/determineFavorite";
import { scorePickCorrect } from "@/lib/scoring/scorePickCorrect";
import { scoreBetPnl } from "@/lib/scoring/scoreBetPnl";
import { aggregateUnitsLine } from "@/lib/scoring/aggregateUnitsLine";
import type { BetResult, UnitsLine } from "@/lib/scoring/aggregateUnitsLine";
import { aggregateAccuracyLine } from "@/lib/scoring/aggregateAccuracyLine";
import type { AccuracyLine } from "@/lib/scoring/aggregateAccuracyLine";
import { fightOutcomeFromSettledFight } from "@/lib/scoring/fightOutcomeFromSettledFight";
import { describeStanceMatchup } from "@/lib/scoring/describeStanceMatchup";
import { computeCalibrationBuckets } from "@/lib/scoring/computeCalibrationBuckets";
import { computeBrierScore } from "@/lib/scoring/computeBrierScore";
import type { BrierScoreResult } from "@/lib/scoring/computeBrierScore";
import { INTERN_LOCK_OFFSET_HOURS } from "@/lib/picks/pickLockOffsets";
import { selectLatestBeforeLock } from "@/lib/shadowPicks/selectLatestBeforeLock";
import type { ShadowPickScoringRow } from "@/lib/shadowPicks/selectLatestBeforeLock";
import { scoreShadowLines } from "@/lib/shadowPicks/scoreShadowLines";
import type { ShadowScoredFight } from "@/lib/shadowPicks/scoreShadowLines";
import type { ScoreboardData, PickTableRow } from "./types";

/**
 * The two boards' whole dataset, computed live rather than stored
 * (ROADMAP.md E1) -- reuses the same pure, already-tested functions D2
 * settles picks with, so there is exactly one definition of "P&L" and
 * "correct" in the codebase, not a second one for reporting.
 *
 * Session-aware client, not the admin client: `picks` has real
 * client-facing RLS ("picks: owner reads all"), and the caller
 * (app/scoreboard/page.tsx) is already owner-gated before this runs --
 * same reasoning as features/picks/api.ts's getMyPicksForFights.
 * `fights`/`odds_snapshots` are public-read, so one client covers all
 * three tables.
 *
 * Chalk's population is every settled, PRICED fight -- independent of
 * what the owner or the intern actually picked (docs/PRD.md UC-4: "flat
 * 1u on every favourite, every fight", not "every fight I picked"). A
 * settled fight with no price (a missed T-12h snapshot -- rare, and
 * already loudly flagged elsewhere by B5's job-health banner) can't
 * produce a chalk bet at all, so it's excluded from every line's units
 * math, "me"/"intern" included -- unlike accuracy, which needs no price
 * and so isn't affected.
 */
export async function getScoreboardData(supabase: SupabaseClient): Promise<ScoreboardData> {
  // Paged reads, filtered in JS -- both changed after the I3/I4 backfill
  // quietly took `settled_at is not null` from ~50 fights to 800+. The
  // old `.in("fight_id", [...800 uuids])` on odds_snapshots built a
  // ~30KB URL that the PostgREST edge rejects outright (URI too long) --
  // a hard 500 on this whole page, live -- and a bare `.select()` on
  // `fights` silently truncates at PostgREST's 1000-row cap, which
  // settled fights cross within weeks. selectAllPages has no filter
  // argument by design, so `settled_at is not null` moves to a JS
  // filter: the same "read broadly, decide in tested code" split this
  // codebase already uses for Elo eligibility, and cheap at these sizes
  // (one owner's picks; one card's worth of fights per week).
  const allFights = await selectAllPages<SettledFightRow>(
    supabase,
    "fights",
    "id, event_id, fighter1_id, fighter2_id, winner_id, weight_class, settled_at, settled_from",
  );
  const settledFights = allFights.filter((f) => f.settled_at !== null);

  const allPicks = await selectAllPages<SettledPickRow>(
    supabase,
    "picks",
    "id, author, fight_id, predicted_fighter_id, estimated_probability, pick_correct, pnl_units, bet_fighter_id, stake_units, settled_at",
  );
  const settledPicks = allPicks.filter((p) => p.settled_at !== null);

  // Everything the intern (and the owner) has riding on fights that
  // haven't settled yet -- so the page says something real before the
  // first card of a window scores, rather than sitting on an empty
  // state while the intern already has dozens of open picks.
  const pending = summarizePendingPicks(
    allPicks.map((p) => ({
      author: p.author,
      settledAt: p.settled_at,
      betFighterId: p.bet_fighter_id,
      stakeUnits: p.stake_units,
    })),
  );

  // odds_snapshots is one immutable row per ever-priced fight (~15 today,
  // a few hundred a year) -- read whole and matched in JS, no `.in()`.
  const allOdds = await selectAllPages<OddsSnapshotRow>(
    supabase,
    "odds_snapshots",
    "id, fight_id, fighter1_price, fighter2_price",
  );
  const settledFightIds = new Set(settledFights.map((f) => f.id));
  const oddsByFightId = new Map(
    allOdds
      .filter((row) => settledFightIds.has(row.fight_id))
      .map((row) => [
        row.fight_id,
        { fighter1_price: row.fighter1_price, fighter2_price: row.fighter2_price },
      ]),
  );

  // Chalk: a synthetic 1-unit bet on the favourite, for every settled
  // fight that was actually priced.
  const chalkPickCorrect: (boolean | null)[] = [];
  const chalkBets: BetResult[] = [];

  for (const fight of settledFights) {
    // M2: a cancelled fight never had a real favourite to bet chalk on --
    // without this, an already-priced-then-cancelled fight would enter
    // chalk as a fabricated 1-unit void bet on whoever the market favoured
    // for a fight that never happened.
    if (fight.settled_from === "cancelled") continue;
    const odds = oddsByFightId.get(fight.id);
    if (!odds) continue;

    const outcome = fightOutcomeFromSettledFight(fight.winner_id);
    const { favoriteId, favoritePrice } = determineFavorite(fight.fighter1_id, fight.fighter2_id, odds);
    chalkPickCorrect.push(scorePickCorrect(favoriteId, outcome));
    chalkBets.push({ stakeUnits: 1, pnlUnits: scoreBetPnl(favoriteId, 1, favoritePrice, outcome)! });
  }

  const mePicks = settledPicks.filter((p) => p.author === "USER");
  const internPicks = settledPicks.filter((p) => p.author === "INTERN");

  // Number(): stake_units and pnl_units are numeric columns, which
  // PostgREST serialises as STRINGS to preserve precision. Cast `as
  // number` alone was a latent bug -- `netUnits += "1.56"` concatenates
  // -- dormant only because nothing has settled yet. The pick-scoring
  // path already coerces (toCalibrationEntry's Number()); this matches it.
  const toBetResult = (p: SettledPickRow): BetResult => ({
    stakeUnits: Number(p.stake_units),
    pnlUnits: Number(p.pnl_units),
  });
  const meUnitsBets = mePicks.filter((p) => p.pnl_units !== null).map(toBetResult);
  const internUnitsBets = internPicks.filter((p) => p.pnl_units !== null).map(toBetResult);

  // Head-to-head: the intern's accuracy restricted to fights the owner
  // ALSO picked -- the PRD's "headline" comparison, since the intern's
  // full population (every fight, once Phase G ships) would otherwise
  // dilute the comparison with fights the owner never judged at all.
  // "Me" needs no equivalent restriction: my own population only ever
  // contains fights I actually picked, so it's already a fair
  // comparison point once the intern exists.
  const meFightIds = new Set(mePicks.map((p) => p.fight_id));
  const internHeadToHeadPickCorrect = internPicks
    .filter((p) => meFightIds.has(p.fight_id))
    .map((p) => p.pick_correct);

  const settledCardCount = new Set(settledFights.map((f) => f.event_id)).size;
  const unpricedSettledPickCount = settledPicks.filter(
    (p) => !oddsByFightId.has(p.fight_id),
  ).length;

  const pickHistory = await buildPickHistory(supabase, settledFights, mePicks, oddsByFightId);

  const shadowComparison = await buildShadowComparison(supabase, settledFights, internPicks, oddsByFightId);

  const toCalibrationEntry = (p: SettledPickRow) => ({
    estimatedProbability: Number(p.estimated_probability),
    correct: p.pick_correct,
  });

  return {
    units: {
      me: aggregateUnitsLine(meUnitsBets),
      intern: aggregateUnitsLine(internUnitsBets),
      chalk: aggregateUnitsLine(chalkBets),
    },
    accuracy: {
      me: aggregateAccuracyLine(mePicks.map((p) => p.pick_correct)),
      intern: {
        ...aggregateAccuracyLine(internPicks.map((p) => p.pick_correct)),
        headToHead: aggregateAccuracyLine(internHeadToHeadPickCorrect),
      },
      chalk: aggregateAccuracyLine(chalkPickCorrect),
    },
    settledCardCount,
    unpricedSettledPickCount,
    pending,
    pickHistory,
    // Each line's own full settled population -- not the head-to-head
    // restriction accuracy uses, since calibration is asking "did this
    // line's own numbers mean what they said," a question every one of
    // its estimates can answer on its own.
    calibration: {
      me: computeCalibrationBuckets(mePicks.map(toCalibrationEntry)),
      intern: computeCalibrationBuckets(internPicks.map(toCalibrationEntry)),
    },
    brier: {
      me: computeBrierScore(mePicks.map(toCalibrationEntry)),
      intern: computeBrierScore(internPicks.map(toCalibrationEntry)),
    },
    shadowComparison,
  };
}

/**
 * N9's readout: reads `shadow_picks` (N8, never client-readable directly
 * -- 0059 only grants the owner a select, and this function always runs
 * behind the session-aware client this whole page already uses once the
 * owner gate above has passed) and scores both lines against the exact
 * same settled fights `settledFights` already established, restricted to
 * fights that were actually eligible for a shadow pick (`settled_from`
 * not `'cancelled'`, and a confirmed `starts_at` to measure a lock
 * instant against -- a card that never got a confirmed time never had a
 * real lock either).
 *
 * `deterministic` reuses `internPicks` -- the SAME real Fork-10 picks the
 * two boards above already show -- restricted to the identical fight
 * population the two shadow lines were scored over, per N9's own
 * confirmed scope: comparing against the intern's whole settled history
 * would not be apples-to-apples with a comparison that only exists for
 * fights that got a shadow pick at all.
 */
async function buildShadowComparison(
  supabase: SupabaseClient,
  settledFights: SettledFightRow[],
  internPicks: SettledPickRow[],
  oddsByFightId: Map<string, { fighter1_price: number; fighter2_price: number }>,
): Promise<ScoreboardData["shadowComparison"]> {
  const eligibleFights = settledFights.filter((f) => f.settled_from !== "cancelled");
  if (eligibleFights.length === 0) return null;

  const eventIds = [...new Set(eligibleFights.map((f) => f.event_id))];
  const events = await selectAllPagesByIds<{ id: string; starts_at: string | null }>(
    supabase,
    "events",
    "id, starts_at",
    "id",
    eventIds,
  );
  const startsAtByEventId = new Map(events.map((e) => [e.id, e.starts_at]));

  const lockAtMsByFightId = new Map<string, number>();
  const fightsById = new Map<string, ShadowScoredFight>();
  for (const fight of eligibleFights) {
    const startsAt = startsAtByEventId.get(fight.event_id);
    if (!startsAt) continue; // no confirmed card time -- never had a real lock instant either
    lockAtMsByFightId.set(fight.id, new Date(startsAt).getTime() - INTERN_LOCK_OFFSET_HOURS * 60 * 60 * 1000);
    fightsById.set(fight.id, {
      fighter1Id: fight.fighter1_id,
      fighter2Id: fight.fighter2_id,
      outcome: fightOutcomeFromSettledFight(fight.winner_id),
      odds: oddsByFightId.get(fight.id) ?? null,
    });
  }
  if (lockAtMsByFightId.size === 0) return null;

  const shadowPickRows = await selectAllPagesByIds<{
    id: string;
    fight_id: string;
    line: "LLM_ASSISTED" | "LLM_ONLY";
    predicted_fighter_id: string;
    probability: number;
    confidence: number | null;
    created_at: string;
  }>(
    supabase,
    "shadow_picks",
    "id, fight_id, line, predicted_fighter_id, probability, confidence, created_at",
    "fight_id",
    [...lockAtMsByFightId.keys()],
  );
  if (shadowPickRows.length === 0) return null;

  const scoringRows: ShadowPickScoringRow[] = shadowPickRows.map((row) => ({
    fightId: row.fight_id,
    line: row.line,
    predictedFighterId: row.predicted_fighter_id,
    probability: Number(row.probability),
    confidence: row.confidence,
    createdAtMs: new Date(row.created_at).getTime(),
  }));

  const selected = selectLatestBeforeLock(scoringRows, lockAtMsByFightId);
  if (selected.length === 0) return null;

  const { llmAssisted, llmOnly } = scoreShadowLines(selected, fightsById);

  const scoredFightIds = new Set(selected.map((r) => r.fightId));
  const comparablePicks = internPicks.filter((p) => scoredFightIds.has(p.fight_id));
  const deterministicUnitsBets: BetResult[] = comparablePicks
    .filter((p) => p.pnl_units !== null)
    .map((p) => ({ stakeUnits: Number(p.stake_units), pnlUnits: Number(p.pnl_units) }));
  const deterministic: { accuracy: AccuracyLine; brier: BrierScoreResult; units: UnitsLine } = {
    accuracy: aggregateAccuracyLine(comparablePicks.map((p) => p.pick_correct)),
    brier: computeBrierScore(
      comparablePicks.map((p) => ({ estimatedProbability: Number(p.estimated_probability), correct: p.pick_correct })),
    ),
    units: aggregateUnitsLine(deterministicUnitsBets),
  };

  return { scoredFightCount: scoredFightIds.size, deterministic, llmAssisted, llmOnly };
}

export interface SettledFightRow {
  id: string;
  event_id: string;
  fighter1_id: string;
  fighter2_id: string;
  winner_id: string | null;
  weight_class: string | null;
  // Selected so the "is this fight settled" check can run in JS --
  // selectAllPages has no server-side filter. Read but not otherwise
  // surfaced.
  settled_at: string | null;
  // M2: excludes a cancelled fight from chalk (see the loop below).
  settled_from: string | null;
}

export interface SettledPickRow {
  id: string;
  author: string;
  fight_id: string;
  predicted_fighter_id: string;
  estimated_probability: number;
  pick_correct: boolean | null;
  bet_fighter_id: string | null;
  stake_units: number | null;
  pnl_units: number | null;
  settled_at: string | null;
}

interface OddsSnapshotRow {
  id: string;
  fight_id: string;
  fighter1_price: number;
  fighter2_price: number;
}

/**
 * E2's filterable pick table (docs/user-flows.md: "pick history lives on
 * /scoreboard as a filterable table under the two boards"). USER picks
 * only -- "pick history" reads naturally as the owner's own log, and the
 * intern has no rows to show yet regardless (Phase G).
 *
 * Two more queries (events, fighters) beyond what the boards themselves
 * needed -- the boards never had to show a name, only a number. Fetched
 * separately and merged in JS rather than an embedded relation, matching
 * this codebase's established preference (features/fights/api.ts's
 * getCardView, features/conflicts/api.ts) over trusting a PostgREST
 * embed shape that hasn't been verified live.
 */
export async function buildPickHistory(
  supabase: SupabaseClient,
  settledFights: SettledFightRow[],
  mePicks: SettledPickRow[],
  oddsByFightId: Map<string, { fighter1_price: number; fighter2_price: number }>,
): Promise<PickTableRow[]> {
  if (mePicks.length === 0) return [];

  const fightById = new Map(settledFights.map((f) => [f.id, f]));

  // Scoped to the fights the OWNER actually picked, not every settled
  // fight -- there are hundreds of the latter now and only ever a
  // handful of the former (one person, a pick or two per card). The old
  // `.in("id", <every settled fighter>)` was the same giant-URL bug the
  // odds fetch above just hit, one `mePicks.length === 0` early-return
  // away from being live.
  const pickedFights = mePicks
    .map((p) => fightById.get(p.fight_id))
    .filter((f): f is SettledFightRow => f !== undefined);

  const eventIds = [...new Set(pickedFights.map((f) => f.event_id))];
  const { data: events, error: eventsError } =
    eventIds.length === 0
      ? { data: [], error: null }
      : await supabase.from("events").select("id, name, event_date").in("id", eventIds);
  if (eventsError) throw eventsError;
  const eventById = new Map(
    (events ?? []).map((e) => [e.id as string, { name: e.name as string, event_date: e.event_date as string }]),
  );

  const fighterIds = [...new Set(pickedFights.flatMap((f) => [f.fighter1_id, f.fighter2_id]))];
  const { data: fighters, error: fightersError } =
    fighterIds.length === 0
      ? { data: [], error: null }
      : await supabase.from("fighters").select("id, name, stance").in("id", fighterIds);
  if (fightersError) throw fightersError;
  const fighterById = new Map(
    (fighters ?? []).map((f) => [f.id as string, { name: f.name as string, stance: f.stance as string | null }]),
  );

  return mePicks.flatMap((pick): PickTableRow[] => {
    const fight = fightById.get(pick.fight_id);
    const event = fight ? eventById.get(fight.event_id) : undefined;
    const fighter1 = fight ? fighterById.get(fight.fighter1_id) : undefined;
    const fighter2 = fight ? fighterById.get(fight.fighter2_id) : undefined;
    // Defensive: every settled pick's fight is itself one of settledFights
    // by construction (both come from the same "settled_at is not null"
    // query family), so this should never actually happen -- but a
    // reporting screen is the wrong place to let a data-integrity
    // surprise crash the page.
    if (!fight || !event || !fighter1 || !fighter2) return [];

    const predictedFighter = pick.predicted_fighter_id === fight.fighter1_id ? fighter1 : fighter2;
    const betFighter =
      pick.bet_fighter_id === null
        ? null
        : pick.bet_fighter_id === fight.fighter1_id
          ? fighter1
          : fighter2;

    const odds = oddsByFightId.get(fight.id);
    const favoriteOrUnderdog: "favorite" | "underdog" | null = odds
      ? determineFavorite(fight.fighter1_id, fight.fighter2_id, odds).favoriteId === pick.predicted_fighter_id
        ? "favorite"
        : "underdog"
      : null;

    return [
      {
        pickId: pick.id,
        fightId: fight.id,
        eventName: event.name,
        eventDate: event.event_date,
        fighter1Name: fighter1.name,
        fighter2Name: fighter2.name,
        weightClass: fight.weight_class,
        predictedFighterName: predictedFighter.name,
        pickCorrect: pick.pick_correct,
        betFighterName: betFighter?.name ?? null,
        // numeric over PostgREST is a STRING -- convert at the boundary
        // (same as toBetResult / toCalibrationEntry above) so the client
        // table's units sum and formatUnits() get real numbers, not
        // "0.75" that concatenates into "00.75-1.00" and crashes .toFixed.
        stakeUnits: pick.stake_units === null ? null : Number(pick.stake_units),
        pnlUnits: pick.pnl_units === null ? null : Number(pick.pnl_units),
        favoriteOrUnderdog,
        stanceMatchup: describeStanceMatchup(fighter1.stance, fighter2.stance),
        // Always false until Phase F -- rumour_flags doesn't exist yet.
        flagPresent: false,
      },
    ];
  });
}
