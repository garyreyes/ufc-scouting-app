import { getSupabaseAdmin } from "../supabase/admin";
import { selectAllPages } from "../supabase/selectAllPages";
import {
  matchSherdogFightResult,
  type SherdogBoutForMatch,
} from "./matchSherdogFightResult";

// J7 verification spike (runnable, read-only): run the matcher against
// fights the app has ALREADY settled and compare its derived winner to
// the real winner_id. This is the "dry-run vs already-settled fights"
// gate before applySherdogResults goes into the settlement chain -- a
// disagreement here means the matching rule is wrong, not that Sherdog
// is wrong.
async function main() {
  const supabase = getSupabaseAdmin();

  const fights = await selectAllPages<{
    id: string;
    event_id: string;
    fighter1_id: string;
    fighter2_id: string;
    winner_id: string | null;
  }>(supabase, "fights", "id, event_id, fighter1_id, fighter2_id, winner_id", (q) =>
    q.not("settled_at", "is", null),
  );

  const events = await selectAllPages<{ id: string; event_date: string | null }>(
    supabase,
    "events",
    "id, event_date",
  );
  const eventDate = new Map(events.map((e) => [e.id, e.event_date]));

  // Whole tables, unfiltered -- a `.in()` over every settled fight's
  // fighters would be hundreds of UUIDs and blow the URL length.
  const fighters = await selectAllPages<{ id: string; sherdog_id: number | null }>(
    supabase,
    "fighters",
    "id, sherdog_id",
  );
  const sherdogId = new Map(fighters.map((f) => [f.id, f.sherdog_id]));

  const bouts = await selectAllPages<{
    id: string;
    fighter_id: string;
    opponent_sherdog_id: number | null;
    result: SherdogBoutForMatch["result"];
    event_date: string | null;
    method: string | null;
    round: number | null;
  }>(
    supabase,
    "fighter_sherdog_bouts",
    "id, fighter_id, opponent_sherdog_id, result, event_date, method, round",
  );
  const boutsByFighter = new Map<string, SherdogBoutForMatch[]>();
  for (const b of bouts) {
    const list = boutsByFighter.get(b.fighter_id) ?? [];
    list.push(b);
    boutsByFighter.set(b.fighter_id, list);
  }

  let bothLinked = 0;
  let matched = 0;
  let agree = 0;
  let ambiguous = 0;
  let noData = 0;
  const disagreements: string[] = [];

  for (const f of fights) {
    const s1 = sherdogId.get(f.fighter1_id) ?? null;
    const s2 = sherdogId.get(f.fighter2_id) ?? null;
    if (s1 == null || s2 == null) continue;
    bothLinked++;

    const result = matchSherdogFightResult(
      {
        fighter1_id: f.fighter1_id,
        fighter1_sherdog_id: s1,
        fighter2_id: f.fighter2_id,
        fighter2_sherdog_id: s2,
        event_date: (eventDate.get(f.event_id) as string) ?? "1970-01-01",
      },
      [...(boutsByFighter.get(f.fighter1_id) ?? []), ...(boutsByFighter.get(f.fighter2_id) ?? [])],
    );

    if (result.status === "ambiguous") ambiguous++;
    else if (result.status === "no_data") noData++;
    else {
      matched++;
      if (result.winnerId === f.winner_id) agree++;
      else disagreements.push(`  fight ${f.id}: app=${f.winner_id ?? "draw/nc"} sherdog=${result.winnerId ?? "draw/nc"}`);
    }
  }

  console.log(`Settled fights with both fighters Sherdog-linked: ${bothLinked}`);
  console.log(`  matched: ${matched}  (agree with app: ${agree}, disagree: ${matched - agree})`);
  console.log(`  ambiguous: ${ambiguous}`);
  console.log(`  no data: ${noData}`);
  if (disagreements.length > 0) {
    console.log("\nDisagreements (investigate the matching rule, not Sherdog):");
    console.log(disagreements.join("\n"));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
