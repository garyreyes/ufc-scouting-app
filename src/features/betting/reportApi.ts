import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllPages } from "@/lib/supabase/selectAllPages";
import { aggregateRoiLine } from "@/lib/scoring/aggregateRoiLine";
import type { RoiLine } from "@/lib/scoring/aggregateRoiLine";
import { aggregateUnitsLine } from "@/lib/scoring/aggregateUnitsLine";
import type { UnitsLine } from "@/lib/scoring/aggregateUnitsLine";
import { buildBankrollCurve } from "@/lib/scoring/buildBankrollCurve";
import type { BankrollPoint } from "@/lib/scoring/buildBankrollCurve";
import { buildBettingHeadToHead } from "@/lib/scoring/buildBettingHeadToHead";
import type { HeadToHeadPair } from "@/lib/scoring/buildBettingHeadToHead";
import type { LegMarket, SlipArchetype } from "./types";

// Q5's own reads, kept separate from api.ts's getOpenSlips (which is
// scoped to status='open' and embeds display fields SlipList needs --
// fight labels, fighter names -- that the report page never renders).
// These three feed pure, tested aggregators in lib/scoring/ rather than
// computing anything themselves, same split scoreboard/api.ts uses.

export interface SettledSlipRow {
  id: string;
  status: "won" | "lost" | "void" | "cashed_out";
  archetype: SlipArchetype;
  stake_php: number | string;
  stake_units: number | string;
  // Generated columns (0064) -- null only while status='open', which this
  // query already excludes, so these are always populated here.
  pnl_php: number | string;
  pnl_units: number | string;
  legs: { fight_id: string | null; market: LegMarket }[];
}

/**
 * Every settled (non-open) USER slip, with just enough leg shape for the
 * head-to-head builder (fight_id/market -- no fighter names, this never
 * renders a leg by itself). bet_slips is small (dozens of rows, not
 * thousands) but selectAllPages is used anyway for the same reason
 * scoreboard/api.ts does: a bare `.select()` silently truncates at
 * PostgREST's 1000-row cap with no error, and there's no reason for this
 * query to be the one exception that trusts row count to stay low forever.
 */
export async function getSettledSlips(supabase: SupabaseClient): Promise<SettledSlipRow[]> {
  const rows = await selectAllPages<{
    id: string;
    status: "open" | "won" | "lost" | "void" | "cashed_out";
    archetype: SlipArchetype;
    stake_php: number | string;
    stake_units: number | string;
    pnl_php: number | string | null;
    pnl_units: number | string | null;
    bet_legs: { fight_id: string | null; market: LegMarket }[];
  }>(
    supabase,
    "bet_slips",
    "id, status, archetype, stake_php, stake_units, pnl_php, pnl_units, bet_legs(fight_id, market)",
    (q) => q.eq("author", "USER").in("status", ["won", "lost", "void", "cashed_out"]),
  );

  return rows.map((row) => ({
    id: row.id,
    // Safe: the query excludes status='open', and 0064's own check
    // constraint (`(status = 'open') = (payout_php is null)`) guarantees
    // pnl_php/pnl_units are non-null whenever status isn't 'open'.
    status: row.status as SettledSlipRow["status"],
    archetype: row.archetype,
    stake_php: row.stake_php,
    stake_units: row.stake_units,
    pnl_php: row.pnl_php!,
    pnl_units: row.pnl_units!,
    legs: row.bet_legs.map((leg) => ({ fight_id: leg.fight_id, market: leg.market })),
  }));
}

export interface LedgerRow {
  occurred_at: string;
  amount_php: number | string;
}

/** The whole bankroll_ledger, oldest first -- buildBankrollCurve.ts sums it. */
export async function getBankrollLedger(supabase: SupabaseClient): Promise<LedgerRow[]> {
  return selectAllPages<{ id: string; occurred_at: string; amount_php: number | string }>(
    supabase,
    "bankroll_ledger",
    "id, occurred_at, amount_php",
  ).then((rows) =>
    // selectAllPages orders by id (its cursor), not occurred_at --
    // buildBankrollCurve.ts requires occurred_at order, so it's applied
    // here rather than trusting insertion order to already match it.
    [...rows].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)),
  );
}

export interface InternSettledPickRow {
  fight_id: string;
  pnl_units: number | string | null;
  stake_units: number | string | null;
  pick_correct: boolean | null;
}

/** INTERN's settled picks -- the other half of the head-to-head. */
export async function getInternSettledPicks(supabase: SupabaseClient): Promise<InternSettledPickRow[]> {
  return selectAllPages<{
    id: string;
    fight_id: string;
    pnl_units: number | string | null;
    stake_units: number | string | null;
    pick_correct: boolean | null;
  }>(supabase, "picks", "id, fight_id, pnl_units, stake_units, pick_correct", (q) =>
    q.eq("author", "INTERN").not("settled_at", "is", null),
  );
}

/**
 * Fighter names for a handful of head-to-head fight ids -- fetched
 * separately and merged in JS, matching this codebase's established
 * preference (features/scoreboard/api.ts's buildPickHistory,
 * features/fights/api.ts's getCardView) over trusting a PostgREST embed
 * shape that hasn't been verified live. The pair list is always small (a
 * handful of overlapping fights), so a plain `.in()` is safe here.
 */
async function getFightLabels(supabase: SupabaseClient, fightIds: string[]): Promise<Map<string, string>> {
  if (fightIds.length === 0) return new Map();

  const { data: fights, error: fightsError } = await supabase
    .from("fights")
    .select("id, fighter1_id, fighter2_id")
    .in("id", fightIds);
  if (fightsError) throw fightsError;

  const fighterIds = [...new Set((fights ?? []).flatMap((f) => [f.fighter1_id as string, f.fighter2_id as string]))];
  const { data: fighters, error: fightersError } =
    fighterIds.length === 0
      ? { data: [], error: null }
      : await supabase.from("fighters").select("id, name").in("id", fighterIds);
  if (fightersError) throw fightersError;
  const nameById = new Map((fighters ?? []).map((f) => [f.id as string, f.name as string]));

  return new Map(
    (fights ?? []).map((f) => [
      f.id as string,
      `${nameById.get(f.fighter1_id as string) ?? "?"} vs ${nameById.get(f.fighter2_id as string) ?? "?"}`,
    ]),
  );
}

// Rendered even with zero bets, matching UnitsBoard's own rule
// (features/scoreboard/components/UnitsBoard.tsx: "a line that disappears
// when it has no data reads as a bug") -- an archetype the owner hasn't
// used yet should read as "no bets", not silently vanish from the board.
export const ALL_ARCHETYPES: SlipArchetype[] = [
  "SAFE_PARLAY",
  "STRAIGHT_DOG",
  "LONGSHOT",
  "METHOD_VALUE",
  "LOCK",
  "OTHER",
];

export interface ArchetypeRoiRow {
  archetype: SlipArchetype;
  line: RoiLine;
}

export interface BettingReportData {
  overall: RoiLine;
  byArchetype: ArchetypeRoiRow[];
  bankrollCurve: BankrollPoint[];
  currentBalancePhp: number | null;
  headToHead: {
    pairs: (HeadToHeadPair & { fightLabel: string })[];
    owner: RoiLine;
    intern: UnitsLine;
  };
}

/**
 * Q5's whole dataset, computed live off the three reads above -- same
 * "reuse the already-tested pure functions" split getScoreboardData uses,
 * so there is exactly one definition of "ROI" and "bankroll balance" in
 * the codebase.
 */
export async function getBettingReportData(supabase: SupabaseClient): Promise<BettingReportData> {
  const [settledSlips, ledgerRows, internPicks] = await Promise.all([
    getSettledSlips(supabase),
    getBankrollLedger(supabase),
    getInternSettledPicks(supabase),
  ]);

  // numeric columns arrive as STRINGS over PostgREST -- converted here at
  // the boundary, same convention as features/scoreboard/api.ts's
  // toBetResult (db-read-safety rule 3).
  const toRoiResult = (slip: SettledSlipRow) => ({
    stakePhp: Number(slip.stake_php),
    pnlPhp: Number(slip.pnl_php),
    stakeUnits: Number(slip.stake_units),
    pnlUnits: Number(slip.pnl_units),
  });

  const overall = aggregateRoiLine(settledSlips.map(toRoiResult));

  const byArchetype: ArchetypeRoiRow[] = ALL_ARCHETYPES.map((archetype) => ({
    archetype,
    line: aggregateRoiLine(
      settledSlips.filter((slip) => slip.archetype === archetype).map(toRoiResult),
    ),
  }));

  const bankrollCurve = buildBankrollCurve(
    ledgerRows.map((row) => ({ occurredAt: row.occurred_at, amountPhp: Number(row.amount_php) })),
  );
  const currentBalancePhp = bankrollCurve.length === 0 ? null : bankrollCurve[bankrollCurve.length - 1].balancePhp;

  const pairs = buildBettingHeadToHead(
    settledSlips.map((slip) => ({
      status: slip.status,
      pnlPhp: Number(slip.pnl_php),
      pnlUnits: Number(slip.pnl_units),
      stakePhp: Number(slip.stake_php),
      stakeUnits: Number(slip.stake_units),
      legs: slip.legs.map((leg) => ({ fightId: leg.fight_id, market: leg.market })),
    })),
    internPicks.map((pick) => ({
      fightId: pick.fight_id,
      pnlUnits: pick.pnl_units === null ? null : Number(pick.pnl_units),
      stakeUnits: pick.stake_units === null ? null : Number(pick.stake_units),
      pickCorrect: pick.pick_correct,
    })),
  );

  const fightLabelById = await getFightLabels(
    supabase,
    [...new Set(pairs.map((p) => p.fightId))],
  );
  const labeledPairs = pairs.map((p) => ({ ...p, fightLabel: fightLabelById.get(p.fightId) ?? "Unknown fight" }));

  return {
    overall,
    byArchetype,
    bankrollCurve,
    currentBalancePhp,
    headToHead: {
      pairs: labeledPairs,
      owner: aggregateRoiLine(
        pairs.map((p) => ({
          stakePhp: p.owner.stakePhp,
          pnlPhp: p.owner.pnlPhp,
          stakeUnits: p.owner.stakeUnits,
          pnlUnits: p.owner.pnlUnits,
        })),
      ),
      intern: aggregateUnitsLine(
        pairs
          .filter((p) => p.intern.pnlUnits !== null && p.intern.stakeUnits !== null)
          .map((p) => ({ stakeUnits: p.intern.stakeUnits!, pnlUnits: p.intern.pnlUnits! })),
      ),
    },
  };
}
