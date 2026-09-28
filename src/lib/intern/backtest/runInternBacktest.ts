import { getSupabaseAdmin } from "../../supabase/admin";
import { selectAllPages } from "../../supabase/selectAllPages";
import { selectAllPagesByIds } from "../../supabase/selectAllPagesByIds";
import { INTERN_V1, INTERN_V2, type InternModelParams } from "../internModel";
import {
  minRatedFromReasoning,
  recoverV1Delta,
  replayInternModel,
  type BacktestFight,
  type ReplayMetrics,
} from "./replayInternModel";

// Phase S1: read-only. Writes nothing. Compares what INTERN v1 actually
// recorded against replays of the same fights under v2 settings.
// npm run intern:backtest

interface PickRow {
  id: string;
  fight_id: string;
  predicted_fighter_id: string;
  estimated_probability: string | number;
  reasoning: string | null;
  signals: { clampedDelta?: number } | null;
  stake_units: string | number | null;
  pnl_units: string | number | null;
}

interface FightRow {
  id: string;
  fighter1_id: string;
  fighter2_id: string;
  winner_id: string | null;
  settled_at: string | null;
}

interface OddsRow {
  id: string;
  fight_id: string;
  fighter1_price: string | number;
  fighter2_price: string | number;
}

async function loadFights(): Promise<{ fights: BacktestFight[]; picks: PickRow[] }> {
  const supabase = getSupabaseAdmin();
  const picks = await selectAllPages<PickRow>(
    supabase,
    "picks",
    "id, fight_id, predicted_fighter_id, estimated_probability, reasoning, signals, stake_units, pnl_units",
    (q) => q.eq("author", "INTERN").not("pick_correct", "is", null),
  );
  const fightIds = picks.map((p) => p.fight_id);
  const [fightRows, oddsRows] = await Promise.all([
    selectAllPagesByIds<FightRow>(supabase, "fights", "id, fighter1_id, fighter2_id, winner_id, settled_at", "id", fightIds),
    selectAllPagesByIds<OddsRow>(supabase, "odds_snapshots", "id, fight_id, fighter1_price, fighter2_price", "fight_id", fightIds),
  ]);
  const fightById = new Map(fightRows.map((f) => [f.id, f]));
  const oddsByFightId = new Map(oddsRows.map((o) => [o.fight_id, o]));

  const fights: BacktestFight[] = [];
  for (const pick of picks) {
    const fight = fightById.get(pick.fight_id);
    const odds = oddsByFightId.get(pick.fight_id);
    if (!fight || !odds || fight.settled_at === null) continue;
    // PostgREST serialises numeric as a string -- coerce before any math.
    const price1 = Number(odds.fighter1_price);
    const price2 = Number(odds.fighter2_price);
    const storedDelta = typeof pick.signals?.clampedDelta === "number" ? pick.signals.clampedDelta : null;
    fights.push({
      fightId: fight.id,
      fighter1Id: fight.fighter1_id,
      fighter2Id: fight.fighter2_id,
      fighter1Price: price1,
      fighter2Price: price2,
      v1Delta: recoverV1Delta(
        storedDelta,
        Number(pick.estimated_probability),
        pick.predicted_fighter_id === fight.fighter1_id,
        price1,
        price2,
      ),
      minRatedFightCount: minRatedFromReasoning(pick.reasoning),
      winnerId: fight.winner_id,
    });
  }
  return { fights, picks: picks.filter((p) => oddsByFightId.has(p.fight_id)) };
}

function row(label: string, m: ReplayMetrics): string {
  const roi = m.roi === null ? "   —   " : `${(m.roi * 100).toFixed(1).padStart(6)}%`;
  return [
    label.padEnd(26),
    m.brier.toFixed(4),
    m.logLoss.toFixed(4),
    `${m.correct}/${m.fights}`.padStart(6),
    String(m.bets).padStart(4),
    String(m.betsWon).padStart(4),
    m.staked.toFixed(2).padStart(7),
    m.pnl.toFixed(2).padStart(7),
    roi,
    `${m.dogBets} (${m.dogPnl.toFixed(2)})`.padStart(12),
  ].join("  ");
}

async function main() {
  const { fights, picks } = await loadFights();

  const market = replayInternModel(fights, { ...INTERN_V2, version: "v2", signalWeight: 0 });
  const v1Probabilities = replayInternModel(fights, INTERN_V1);

  // v1 as actually recorded (its own bet rule, its own settled P&L).
  const staked = picks.reduce((s, p) => s + (p.stake_units === null ? 0 : Number(p.stake_units)), 0);
  const pnl = picks.reduce((s, p) => s + (p.pnl_units === null ? 0 : Number(p.pnl_units)), 0);
  const betRows = picks.filter((p) => p.stake_units !== null);

  console.log(`INTERN backtest — ${fights.length} settled, priced fights\n`);
  console.log(
    ["model".padEnd(26), "brier ", "logloss", "correct", "bets", " won", " staked", "    pnl", "   roi ", " dog bets(pnl)"].join("  "),
  );
  console.log(row("market (weight 0)", market));
  console.log(
    `${row("v1 probs + v2 bet rule", v1Probabilities)}\n` +
      `${"v1 as recorded".padEnd(26)}  ${" ".repeat(24)}  ${String(betRows.length).padStart(4)}  ` +
      `${String(betRows.filter((p) => Number(p.pnl_units) > 0).length).padStart(4)}  ${staked.toFixed(2).padStart(7)}  ` +
      `${pnl.toFixed(2).padStart(7)}  ${staked ? `${((pnl / staked) * 100).toFixed(1).padStart(6)}%` : ""}`,
  );

  for (const weight of [0.15, 0.25, 0.35, 0.5, 0.75]) {
    const params: InternModelParams = { ...INTERN_V2, signalWeight: weight };
    const label = `v2 weight ${weight}${weight === INTERN_V2.signalWeight ? "  <- shipped" : ""}`;
    console.log(row(label, replayInternModel(fights, params)));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
