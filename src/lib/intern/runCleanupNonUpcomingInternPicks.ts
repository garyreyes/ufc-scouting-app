import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchNearestUpcomingEventId } from "../events/nearestUpcomingEvent";
import { selectAllPages } from "../supabase/selectAllPages";
import { getSupabaseAdmin } from "../supabase/admin";

/**
 * ONE-TIME cleanup for Phase L1. Before L1, generateInternPicks wrote a
 * pick for every fight on every future card; L1 narrows it to the single
 * nearest card. This removes the INTERN picks already sitting on the
 * *other* future cards so those cards read empty until they are next up
 * (the intern regenerates them fresh -- with real odds by then).
 *
 * Scope, stated explicitly:
 *   IN  -- picks where author = 'INTERN' AND the fight's event is upcoming
 *          (event_date >= today, merged_into is null) AND that event is
 *          NOT the nearest upcoming one.
 *   OUT -- every INTERN pick on the nearest upcoming card (kept).
 *   OUT -- every INTERN pick on a past card (still needs to settle).
 *   OUT -- every USER pick, on any card (the owner's own; never touched).
 *
 * Dry-run by default: prints the per-event breakdown and totals, writes
 * nothing. Pass --commit to actually delete. Refuses to commit if any
 * target pick carries a bet or is already settled -- neither should exist
 * on a future card, and if one does that is a real anomaly to look at,
 * not something to delete silently.
 */

interface EventRow {
  id: string;
  name: string;
  event_date: string;
}

interface FightRow {
  id: string;
  event_id: string;
}

interface PickRow {
  id: string;
  fight_id: string;
  bet_fighter_id: string | null;
  stake_units: number | null;
  settled_at: string | null;
}

interface CleanupPlan {
  nearestEventId: string | null;
  staleEvents: { id: string; name: string; date: string; pickCount: number }[];
  totalPicks: number;
  picksWithBets: number;
  picksSettled: number;
  targetPickIds: string[];
}

async function planCleanup(supabase: SupabaseClient): Promise<CleanupPlan> {
  const today = new Date().toISOString().slice(0, 10);
  const nearestEventId = await fetchNearestUpcomingEventId(supabase);

  const { data: upcomingRaw, error: eventsError } = await supabase
    .from("events")
    .select("id, name, event_date")
    .gte("event_date", today)
    .is("merged_into", null)
    .order("event_date", { ascending: true });
  if (eventsError) throw eventsError;
  const staleEventRows = ((upcomingRaw ?? []) as EventRow[]).filter((e) => e.id !== nearestEventId);
  const staleEventIds = staleEventRows.map((e) => e.id);

  if (staleEventIds.length === 0) {
    return {
      nearestEventId,
      staleEvents: [],
      totalPicks: 0,
      picksWithBets: 0,
      picksSettled: 0,
      targetPickIds: [],
    };
  }

  const fights = await selectAllPages<FightRow>(supabase, "fights", "id, event_id", (q) =>
    q.in("event_id", staleEventIds),
  );
  const eventByFightId = new Map(fights.map((f) => [f.id, f.event_id]));
  const fightIds = fights.map((f) => f.id);

  const picks =
    fightIds.length === 0
      ? []
      : await selectAllPages<PickRow>(
          supabase,
          "picks",
          "id, fight_id, bet_fighter_id, stake_units, settled_at",
          (q) => q.eq("author", "INTERN").in("fight_id", fightIds),
        );

  const countByEvent = new Map<string, number>();
  for (const p of picks) {
    const evId = eventByFightId.get(p.fight_id);
    if (evId) countByEvent.set(evId, (countByEvent.get(evId) ?? 0) + 1);
  }

  return {
    nearestEventId,
    staleEvents: staleEventRows.map((e) => ({
      id: e.id,
      name: e.name,
      date: e.event_date,
      pickCount: countByEvent.get(e.id) ?? 0,
    })),
    totalPicks: picks.length,
    picksWithBets: picks.filter((p) => p.bet_fighter_id !== null || p.stake_units !== null).length,
    picksSettled: picks.filter((p) => p.settled_at !== null).length,
    targetPickIds: picks.map((p) => p.id),
  };
}

function printPlan(plan: CleanupPlan): void {
  console.log("Nearest upcoming card (kept):", plan.nearestEventId ?? "(none)");
  console.log("\nINTERN picks on non-nearest upcoming cards:");
  for (const e of plan.staleEvents) {
    console.log(`  ${e.date}  ${e.name.padEnd(44)}  ${String(e.pickCount).padStart(3)} picks`);
  }
  console.log(
    `\n  ${plan.staleEvents.length} events, ${plan.totalPicks} picks total, ` +
      `${plan.picksWithBets} with a bet, ${plan.picksSettled} settled`,
  );
}

async function main() {
  const commit = process.argv.includes("--commit");
  const supabase = getSupabaseAdmin();
  const plan = await planCleanup(supabase);

  printPlan(plan);

  if (plan.totalPicks === 0) {
    console.log("\nNothing to delete.");
    return;
  }

  if (plan.picksWithBets > 0 || plan.picksSettled > 0) {
    console.error(
      `\nREFUSING: ${plan.picksWithBets} target pick(s) carry a bet and ${plan.picksSettled} are settled. ` +
        "A future card should have neither -- investigate before deleting anything.",
    );
    process.exit(1);
  }

  if (!commit) {
    console.log("\nDRY RUN -- nothing deleted. Re-run with --commit to delete the picks above.");
    return;
  }

  // picks has no DELETE policy for any client role, but service_role
  // bypasses RLS and keeps its default DELETE grant (0019 only withholds
  // one from `authenticated`). The trigger is BEFORE INSERT OR UPDATE
  // only, so a DELETE on an unlocked future card is unobstructed.
  const CHUNK = 200;
  let deleted = 0;
  for (let i = 0; i < plan.targetPickIds.length; i += CHUNK) {
    const batch = plan.targetPickIds.slice(i, i + CHUNK);
    const { error } = await supabase.from("picks").delete().in("id", batch);
    if (error) throw error;
    deleted += batch.length;
  }
  console.log(`\nDeleted ${deleted} INTERN picks.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
