import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllPages } from "@/lib/supabase/selectAllPages";
import { aggregateRoiLine } from "@/lib/scoring/aggregateRoiLine";
import { buildBankrollCurve } from "@/lib/scoring/buildBankrollCurve";
import { fetchNearestUpcomingEventId } from "@/lib/events/nearestUpcomingEvent";
import { isPickLocked } from "@/lib/picks/pickLockOffsets";
import { getBankrollLedger } from "@/features/betting/reportApi";
import { SLIP_TYPE_ORDER } from "./types";
import type { InternCardView, InternSlipView, InternSlipsPageData, SlateArchetype } from "./types";

// Phase T5: everything /intern-slips shows, read with the owner's session
// client -- bet_slips/bet_legs/bankroll_ledger are all "owner reads all"
// (0064), so RLS is the gate, same trust model as features/betting/api.ts.

interface SlipRow {
  id: string;
  event_id: string | null;
  archetype: SlateArchetype;
  status: InternSlipView["status"];
  stake_php: string | number;
  stake_units: string | number;
  combined_price: string | number;
  pnl_php: string | number | null;
  pnl_units: string | number | null;
  bet_legs: {
    id: string;
    selection_detail: string | null;
    price: string | number;
    price_source: InternSlipView["legs"][number]["priceSource"];
    leg_result: InternSlipView["legs"][number]["result"];
    model_probability: string | number | null;
  }[];
}

interface EventRow {
  id: string;
  name: string;
  event_date: string;
  starts_at: string | null;
}

// numeric columns arrive as strings over PostgREST -- converted here.
function toSlipView(row: SlipRow): InternSlipView {
  return {
    id: row.id,
    archetype: row.archetype,
    status: row.status,
    stakePhp: Number(row.stake_php),
    combinedPrice: Number(row.combined_price),
    pnlPhp: row.pnl_php === null ? null : Number(row.pnl_php),
    legs: row.bet_legs.map((l) => ({
      id: l.id,
      detail: l.selection_detail ?? "",
      price: Number(l.price),
      priceSource: l.price_source,
      result: l.leg_result,
      modelProbability: l.model_probability === null ? null : Number(l.model_probability),
    })),
  };
}

function byType(a: InternSlipView, b: InternSlipView): number {
  return SLIP_TYPE_ORDER.indexOf(a.archetype) - SLIP_TYPE_ORDER.indexOf(b.archetype);
}

function toCard(event: EventRow, slips: InternSlipView[]): InternCardView {
  return {
    eventId: event.id,
    eventName: event.name,
    eventDate: event.event_date,
    slips: [...slips].sort(byType),
    netPhp: slips.reduce((s, x) => s + (x.pnlPhp ?? 0), 0),
    stakedPhp: slips.reduce((s, x) => s + x.stakePhp, 0),
  };
}

async function loadEvents(supabase: SupabaseClient, ids: string[]): Promise<Map<string, EventRow>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from("events").select("id, name, event_date, starts_at").in("id", ids);
  if (error) throw error;
  return new Map(((data ?? []) as EventRow[]).map((e) => [e.id, e]));
}

export async function getInternSlipsPageData(supabase: SupabaseClient): Promise<InternSlipsPageData> {
  const [rows, ledger, upcomingId] = await Promise.all([
    selectAllPages<SlipRow>(
      supabase,
      "bet_slips",
      "id, event_id, archetype, status, stake_php, stake_units, combined_price, pnl_php, pnl_units, " +
        "bet_legs(id, selection_detail, price, price_source, leg_result, model_probability)",
      (q) => q.eq("author", "INTERN"),
    ),
    getBankrollLedger(supabase, "INTERN"),
    fetchNearestUpcomingEventId(supabase),
  ]);

  const eventIds = [...new Set([...rows.map((r) => r.event_id), upcomingId].filter((id): id is string => id !== null))];
  const events = await loadEvents(supabase, eventIds);

  const curve = buildBankrollCurve(ledger.map((l) => ({ occurredAt: l.occurred_at, amountPhp: Number(l.amount_php) })));
  const openingPhp = ledger.length > 0 ? Number(ledger[0].amount_php) : 0;

  const settled = rows.filter((r) => r.status !== "open");
  const toRoi = (r: SlipRow) => ({
    stakePhp: Number(r.stake_php),
    pnlPhp: Number(r.pnl_php),
    stakeUnits: Number(r.stake_units),
    pnlUnits: Number(r.pnl_units),
  });

  const slipsByEvent = new Map<string, InternSlipView[]>();
  for (const r of rows) {
    if (r.event_id === null) continue;
    slipsByEvent.set(r.event_id, [...(slipsByEvent.get(r.event_id) ?? []), toSlipView(r)]);
  }

  const upcomingEvent = upcomingId === null ? undefined : events.get(upcomingId);
  const past = [...slipsByEvent.entries()]
    .filter(([id]) => id !== upcomingId && events.has(id))
    .map(([id, slips]) => toCard(events.get(id)!, slips))
    .sort((a, b) => b.eventDate.localeCompare(a.eventDate));

  return {
    openingPhp,
    balancePhp: curve.length === 0 ? 0 : curve[curve.length - 1].balancePhp,
    overall: aggregateRoiLine(settled.map(toRoi)),
    byArchetype: SLIP_TYPE_ORDER.map((archetype) => ({
      archetype,
      line: aggregateRoiLine(settled.filter((r) => r.archetype === archetype).map(toRoi)),
    })),
    curve,
    upcoming: upcomingEvent
      ? {
          ...toCard(upcomingEvent, slipsByEvent.get(upcomingEvent.id) ?? []),
          startsAt: upcomingEvent.starts_at,
          locked: isPickLocked(upcomingEvent.starts_at, "INTERN", new Date()),
        }
      : null,
    past,
  };
}
