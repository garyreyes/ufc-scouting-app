import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllPages } from "@/lib/supabase/selectAllPages";
import { determineFavorite } from "@/lib/scoring/determineFavorite";
import { scorePickCorrect } from "@/lib/scoring/scorePickCorrect";
import { scoreBetPnl } from "@/lib/scoring/scoreBetPnl";
import { aggregateUnitsLine } from "@/lib/scoring/aggregateUnitsLine";
import type { BetResult } from "@/lib/scoring/aggregateUnitsLine";
import { aggregateAccuracyLine } from "@/lib/scoring/aggregateAccuracyLine";
import { fightOutcomeFromSettledFight } from "@/lib/scoring/fightOutcomeFromSettledFight";
import { describeStanceMatchup } from "@/lib/scoring/describeStanceMatchup";
import { computeCalibrationBuckets } from "@/lib/scoring/computeCalibrationBuckets";
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
    "id, event_id, fighter1_id, fighter2_id, winner_id, weight_class, settled_at",
  );
  const settledFights = allFights.filter((f) => f.settled_at !== null);

  const allPicks = await selectAllPages<SettledPickRow>(
    supabase,
    "picks",
    "id, author, fight_id, predicted_fighter_id, estimated_probability, pick_correct, pnl_units, bet_fighter_id, stake_units, settled_at",
  );
  const settledPicks = allPicks.filter((p) => p.settled_at !== null);

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
    const odds = oddsByFightId.get(fight.id);
    if (!odds) continue;

    const outcome = fightOutcomeFromSettledFight(fight.winner_id);
    const { favoriteId, favoritePrice } = determineFavorite(fight.fighter1_id, fight.fighter2_id, odds);
    chalkPickCorrect.push(scorePickCorrect(favoriteId, outcome));
    chalkBets.push({ stakeUnits: 1, pnlUnits: scoreBetPnl(favoriteId, 1, favoritePrice, outcome)! });
  }

  const mePicks = settledPicks.filter((p) => p.author === "USER");
  const internPicks = settledPicks.filter((p) => p.author === "INTERN");

  const toBetResult = (p: SettledPickRow): BetResult => ({
    stakeUnits: p.stake_units as number,
    pnlUnits: p.pnl_units as number,
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
    pickHistory,
    // Each line's own full settled population -- not the head-to-head
    // restriction accuracy uses, since calibration is asking "did this
    // line's own numbers mean what they said," a question every one of
    // its estimates can answer on its own.
    calibration: {
      me: computeCalibrationBuckets(mePicks.map(toCalibrationEntry)),
      intern: computeCalibrationBuckets(internPicks.map(toCalibrationEntry)),
    },
  };
}

interface SettledFightRow {
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
}

interface SettledPickRow {
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
async function buildPickHistory(
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
        stakeUnits: pick.stake_units,
        pnlUnits: pick.pnl_units,
        favoriteOrUnderdog,
        stanceMatchup: describeStanceMatchup(fighter1.stance, fighter2.stance),
        // Always false until Phase F -- rumour_flags doesn't exist yet.
        flagPresent: false,
      },
    ];
  });
}
