import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchNearestUpcomingEventId } from "../../events/nearestUpcomingEvent";
import { isPickLocked } from "../../picks/pickLockOffsets";
import type { FightMethod } from "../../scoring/fightMethod";
import { selectAllPages } from "../../supabase/selectAllPages";
import { selectAllPagesByIds } from "../../supabase/selectAllPagesByIds";
import { modelVersionOf } from "../internModel";
import type { InternPickSignals } from "../types";
import { assembleInternSlate } from "./assembleInternSlate";
import { CARD_BUDGET_FRACTION } from "./slateStaking";
import {
  applyEnteredPrices,
  availableBalance,
  generationKey,
  slateSignature,
  type EnteredPrice,
} from "./slatePersistence";
import type { SlateFight, SlateSlip } from "./types";

// Phase T4 (ROADMAP_V2.md): writes the nearest card's INTERN slate. Runs
// right after the picks job (intern.yml), rebuilding the slate from the
// Intern's latest picks until the Intern pick lock (T-6h), then leaves it
// frozen -- the same window the picks themselves can change in.

const PESOS_PER_UNIT = 100; // lib/betting/ownerSlipSeed.ts's own policy value

export interface InternSlateSummary {
  eventId: string | null;
  frozen: boolean;
  unchanged: boolean;
  balancePhp: number;
  budgetPhp: number;
  stakedPhp: number;
  slipsWritten: number;
  slipsReplaced: number;
  slate: SlateSlip[];
}

interface FightRow {
  id: string;
  fighter1_id: string;
  fighter2_id: string;
  fighter1: { name: string };
  fighter2: { name: string };
}

interface PickRow {
  id: string;
  fight_id: string;
  author: "USER" | "INTERN";
  predicted_fighter_id: string;
  estimated_probability: string | number;
  confidence: number;
  predicted_method: FightMethod | null;
  bet_fighter_id: string | null;
  signals: InternPickSignals | null;
}

interface ExistingSlipRow {
  id: string;
  generation_key: string | null;
  stake_php: string | number;
  bet_legs: {
    fight_id: string;
    market: string;
    selection_fighter_id: string | null;
    method_group: string | null;
    price: string | number;
    price_source: string;
  }[];
}

async function loadCard(supabase: SupabaseClient, eventId: string): Promise<SlateFight[]> {
  const { data, error } = await supabase
    .from("fights")
    .select("id, fighter1_id, fighter2_id, fighter1:fighter1_id(name), fighter2:fighter2_id(name)")
    .eq("event_id", eventId)
    .is("settled_at", null);
  if (error) throw error;
  const fights = (data ?? []) as unknown as FightRow[];
  const fightIds = fights.map((f) => f.id);

  const [picks, odds] = await Promise.all([
    selectAllPagesByIds<PickRow>(
      supabase,
      "picks",
      "id, fight_id, predicted_fighter_id, estimated_probability, confidence, predicted_method, bet_fighter_id, signals, author",
      "fight_id",
      fightIds,
    ),
    selectAllPagesByIds<{ id: string; fight_id: string; fighter1_price: string | number; fighter2_price: string | number }>(
      supabase,
      "odds_snapshots",
      "id, fight_id, fighter1_price, fighter2_price",
      "fight_id",
      fightIds,
    ),
  ]);
  // Only the live model's picks feed the slate -- a v1 pick is a read the
  // Intern no longer stands behind.
  const pickByFight = new Map(
    picks
      .filter((p) => p.author === "INTERN" && modelVersionOf(p.signals) === "v2")
      .map((p) => [p.fight_id, p]),
  );
  const oddsByFight = new Map(odds.map((o) => [o.fight_id, o]));

  const card: SlateFight[] = [];
  for (const f of fights) {
    const pick = pickByFight.get(f.id);
    if (!pick) continue;
    const o = oddsByFight.get(f.id);
    card.push({
      fightId: f.id,
      fighter1Id: f.fighter1_id,
      fighter2Id: f.fighter2_id,
      fighter1Name: f.fighter1.name,
      fighter2Name: f.fighter2.name,
      odds: o ? { fighter1Price: Number(o.fighter1_price), fighter2Price: Number(o.fighter2_price) } : null,
      predictedFighterId: pick.predicted_fighter_id,
      estimatedProbability: Number(pick.estimated_probability),
      confidence: pick.confidence,
      predictedMethod: pick.predicted_method,
      methodDistribution: pick.signals?.methodDistribution ?? null,
      betFighterId: pick.bet_fighter_id,
    });
  }
  return card;
}

async function loadBalance(supabase: SupabaseClient, eventId: string): Promise<number> {
  const [ledger, openSlips] = await Promise.all([
    selectAllPages<{ id: string; amount_php: string | number }>(supabase, "bankroll_ledger", "id, amount_php", (q) =>
      q.eq("author", "INTERN"),
    ),
    selectAllPages<{ id: string; event_id: string | null; stake_php: string | number }>(
      supabase,
      "bet_slips",
      "id, event_id, stake_php",
      (q) => q.eq("author", "INTERN").eq("status", "open"),
    ),
  ]);
  const otherCards = openSlips.filter((s) => s.event_id !== eventId).map((s) => s.stake_php);
  return availableBalance(
    ledger.map((l) => l.amount_php),
    otherCards,
  );
}

async function loadExisting(supabase: SupabaseClient, eventId: string): Promise<ExistingSlipRow[]> {
  const { data, error } = await supabase
    .from("bet_slips")
    .select("id, generation_key, stake_php, bet_legs(fight_id, market, selection_fighter_id, method_group, price, price_source)")
    .eq("author", "INTERN")
    .eq("event_id", eventId)
    .eq("status", "open");
  if (error) throw error;
  return (data ?? []) as unknown as ExistingSlipRow[];
}

// Rebuilds the existing rows into the same shape the signature compares.
function existingAsSlate(rows: ExistingSlipRow[]): SlateSlip[] {
  return rows.map((r) => {
    const [, , archetype, index] = (r.generation_key ?? "").split(":");
    return {
      archetype: archetype as SlateSlip["archetype"],
      index: Number(index),
      stakePhp: Number(r.stake_php),
      combinedPrice: 0,
      modelProbability: 0,
      legs: r.bet_legs.map((l) => ({
        fightId: l.fight_id,
        market: l.market as "MONEYLINE" | "METHOD_FIGHTER",
        selectionFighterId: l.selection_fighter_id ?? "",
        selectionDetail: "",
        methodGroup: l.method_group as SlateSlip["legs"][number]["methodGroup"],
        price: Number(l.price),
        priceSource: "book",
        modelProbability: 0,
      })),
    };
  });
}

function enteredPrices(rows: ExistingSlipRow[]): EnteredPrice[] {
  return rows.flatMap((r) =>
    r.bet_legs
      .filter((l) => l.price_source === "entered")
      .map((l) => ({
        fightId: l.fight_id,
        market: l.market,
        selectionFighterId: l.selection_fighter_id,
        methodGroup: l.method_group,
        price: Number(l.price),
      })),
  );
}

/**
 * Insert-then-swap, not delete-then-insert (reviewer finding): the new
 * slate is written in full first, without generation keys (null never
 * collides with the old slips' unique keys). Only once every slip and leg
 * is in do the old slips go and the new ones take their keys. A failure
 * part-way through removes whatever of the new slate was written and
 * leaves the old slate untouched -- never a half slate. If the final key
 * step itself fails, the keyless slips read as changed next run and are
 * rebuilt.
 */
async function writeSlate(supabase: SupabaseClient, eventId: string, slate: SlateSlip[], replaceIds: string[]) {
  const insertedIds: string[] = [];
  try {
    for (const s of slate) insertedIds.push(await insertSlip(supabase, eventId, s));
  } catch (err) {
    if (insertedIds.length > 0) await supabase.from("bet_slips").delete().in("id", insertedIds);
    throw err;
  }

  if (replaceIds.length > 0) {
    // Open slips carry no ledger row (only settlement writes one), so the
    // ledger's restrict FK can't block this; legs cascade.
    const { error } = await supabase.from("bet_slips").delete().in("id", replaceIds);
    if (error) throw error;
  }
  for (const [i, s] of slate.entries()) {
    const { error } = await supabase
      .from("bet_slips")
      .update({ generation_key: generationKey(eventId, s.archetype, s.index) })
      .eq("id", insertedIds[i]);
    if (error) throw error;
  }
}

async function insertSlip(supabase: SupabaseClient, eventId: string, s: SlateSlip): Promise<string> {
  const placedAt = new Date().toISOString();
  const { data: row, error } = await supabase
    .from("bet_slips")
    .insert({
      event_id: eventId,
      author: "INTERN",
      user_id: null,
      archetype: s.archetype,
      stake_php: s.stakePhp,
      stake_units: Math.round((s.stakePhp / PESOS_PER_UNIT) * 100) / 100,
      book: "Paper (BetOnline reference)",
      combined_price: s.combinedPrice,
      placed_at: placedAt,
      // Keyed only after the whole slate is in -- see writeSlate.
      generation_key: null,
      note: `Intern model P ${(s.modelProbability * 100).toFixed(1)}%`,
    })
    .select("id")
    .single();
  if (error) throw error;
  await insertLegs(supabase, row.id as string, s);
  return row.id as string;
}

async function insertLegs(supabase: SupabaseClient, slipId: string, s: SlateSlip) {
  const { error } = await supabase.from("bet_legs").insert(
    s.legs.map((l) => ({
      slip_id: slipId,
      fight_id: l.fightId,
      market: l.market,
      selection_fighter_id: l.selectionFighterId,
      selection_detail: l.selectionDetail,
      method_group: l.methodGroup,
      price: l.price,
      price_source: l.priceSource,
      model_probability: Math.round(l.modelProbability * 10000) / 10000,
    })),
  );
  if (error) {
    // Never leave a slip with no legs behind.
    await supabase.from("bet_slips").delete().eq("id", slipId);
    throw error;
  }
}

export async function generateInternSlate(
  supabase: SupabaseClient,
  options: { dryRun?: boolean; now?: Date } = {},
): Promise<InternSlateSummary> {
  const summary: InternSlateSummary = {
    eventId: null, frozen: false, unchanged: false, balancePhp: 0, budgetPhp: 0,
    stakedPhp: 0, slipsWritten: 0, slipsReplaced: 0, slate: [],
  };
  const eventId = await fetchNearestUpcomingEventId(supabase);
  if (eventId === null) return summary;
  summary.eventId = eventId;

  const { data: event, error } = await supabase.from("events").select("starts_at").eq("id", eventId).single();
  if (error) throw error;
  if (isPickLocked(event.starts_at as string | null, "INTERN", options.now ?? new Date())) {
    summary.frozen = true;
    return summary;
  }

  const [card, balance, existing] = await Promise.all([
    loadCard(supabase, eventId),
    loadBalance(supabase, eventId),
    loadExisting(supabase, eventId),
  ]);
  const slate = applyEnteredPrices(assembleInternSlate(card, balance), enteredPrices(existing));
  summary.balancePhp = balance;
  summary.budgetPhp = CARD_BUDGET_FRACTION * Math.max(0, balance);
  summary.stakedPhp = slate.reduce((s, x) => s + x.stakePhp, 0);
  summary.slate = slate;

  if (slateSignature(slate) === slateSignature(existingAsSlate(existing))) {
    summary.unchanged = true;
    return summary;
  }
  if (options.dryRun) return summary;

  await writeSlate(supabase, eventId, slate, existing.map((r) => r.id));
  summary.slipsReplaced = existing.length;
  summary.slipsWritten = slate.length;
  return summary;
}
