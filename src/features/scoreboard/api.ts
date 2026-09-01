import type { SupabaseClient } from "@supabase/supabase-js";
import { determineFavorite } from "@/lib/scoring/determineFavorite";
import { scorePickCorrect } from "@/lib/scoring/scorePickCorrect";
import { scoreBetPnl } from "@/lib/scoring/scoreBetPnl";
import { aggregateUnitsLine } from "@/lib/scoring/aggregateUnitsLine";
import type { BetResult } from "@/lib/scoring/aggregateUnitsLine";
import { aggregateAccuracyLine } from "@/lib/scoring/aggregateAccuracyLine";
import { fightOutcomeFromSettledFight } from "@/lib/scoring/fightOutcomeFromSettledFight";
import type { ScoreboardData } from "./types";

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
  const { data: settledFights, error: fightsError } = await supabase
    .from("fights")
    .select("id, event_id, fighter1_id, fighter2_id, winner_id")
    .not("settled_at", "is", null);
  if (fightsError) throw fightsError;

  const fightIds = (settledFights ?? []).map((f) => f.id as string);
  const { data: oddsRows, error: oddsError } =
    fightIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("odds_snapshots")
          .select("fight_id, fighter1_price, fighter2_price")
          .in("fight_id", fightIds);
  if (oddsError) throw oddsError;
  const oddsByFightId = new Map(
    (oddsRows ?? []).map((row) => [
      row.fight_id as string,
      { fighter1_price: row.fighter1_price as number, fighter2_price: row.fighter2_price as number },
    ]),
  );

  const { data: settledPicks, error: picksError } = await supabase
    .from("picks")
    .select("author, fight_id, pick_correct, pnl_units, bet_fighter_id, stake_units")
    .not("settled_at", "is", null);
  if (picksError) throw picksError;

  // Chalk: a synthetic 1-unit bet on the favourite, for every settled
  // fight that was actually priced.
  const chalkPickCorrect: (boolean | null)[] = [];
  const chalkBets: BetResult[] = [];

  for (const fight of settledFights ?? []) {
    const odds = oddsByFightId.get(fight.id as string);
    if (!odds) continue;

    const outcome = fightOutcomeFromSettledFight(fight.winner_id as string | null);
    const { favoriteId, favoritePrice } = determineFavorite(
      fight.fighter1_id as string,
      fight.fighter2_id as string,
      odds,
    );
    chalkPickCorrect.push(scorePickCorrect(favoriteId, outcome));
    chalkBets.push({ stakeUnits: 1, pnlUnits: scoreBetPnl(favoriteId, 1, favoritePrice, outcome)! });
  }

  const mePicks = (settledPicks ?? []).filter((p) => p.author === "USER");
  const internPicks = (settledPicks ?? []).filter((p) => p.author === "INTERN");

  const toBetResult = (p: { stake_units: unknown; pnl_units: unknown }): BetResult => ({
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
  const meFightIds = new Set(mePicks.map((p) => p.fight_id as string));
  const internHeadToHeadPickCorrect = internPicks
    .filter((p) => meFightIds.has(p.fight_id as string))
    .map((p) => p.pick_correct as boolean | null);

  const settledCardCount = new Set((settledFights ?? []).map((f) => f.event_id as string)).size;
  const unpricedSettledPickCount = (settledPicks ?? []).filter(
    (p) => !oddsByFightId.has(p.fight_id as string),
  ).length;

  return {
    units: {
      me: aggregateUnitsLine(meUnitsBets),
      intern: aggregateUnitsLine(internUnitsBets),
      chalk: aggregateUnitsLine(chalkBets),
    },
    accuracy: {
      me: aggregateAccuracyLine(mePicks.map((p) => p.pick_correct as boolean | null)),
      intern: {
        ...aggregateAccuracyLine(internPicks.map((p) => p.pick_correct as boolean | null)),
        headToHead: aggregateAccuracyLine(internHeadToHeadPickCorrect),
      },
      chalk: aggregateAccuracyLine(chalkPickCorrect),
    },
    settledCardCount,
    unpricedSettledPickCount,
  };
}
