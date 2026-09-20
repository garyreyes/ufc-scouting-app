import { getSupabaseAdmin } from "../supabase/admin";
import { settleSlip } from "./settleSlip";
import type { LegForRollup } from "./settleSlip";
import { OWNER_SLIP_SEED, OWNER_USER_ID, PESOS_PER_UNIT } from "./ownerSlipSeed";
import type { SeedSlip } from "./ownerSlipSeed";

// Q3. Dry-run by default: nothing is written unless --apply is passed,
// per CLAUDE.md's mandatory dry-run rule for bulk data-mutating jobs.
//
// Idempotent on bookmaker_bet_id, so re-running over overlapping
// screenshots cannot double-insert. The three slips whose ticket number
// was cut off carry a null id and are instead matched on
// (placed_at, stake_php) -- weaker, but those three are also the only
// ones a re-run could duplicate, and the dry run names them.
//
// User-confirmed 2026-09-21: these 16 tickets are recorded as REFERENCE
// material for the archetype/INTERN comparison, not as live bankroll
// history -- they predate this journal existing. Slips and legs are
// written (status/payout/pnl as printed, so settleSlip's own math is
// checkable against them), but NO bankroll_ledger row is written per
// slip. The bankroll starts at a flat P10,000 opening deposit and moves
// only from bets recorded going forward.

const OPENING_BANKROLL_PHP = 10000;
const OPENING_BANKROLL_AT = "2026-08-22T00:00:00Z";

interface FightRow {
  id: string;
  fighter1_id: string;
  fighter2_id: string;
}

function unitsFor(stakePhp: number): number {
  return Math.round((stakePhp / PESOS_PER_UNIT) * 100) / 100;
}

/** The ticket is the record of truth; this only checks we transcribed it consistently. */
function crossCheckAgainstEngine(slip: SeedSlip): string | null {
  const legs: LegForRollup[] = slip.legs.map((leg) => ({ result: leg.legResult, price: leg.price }));
  const computed = settleSlip(legs, slip.stakePhp);

  if (computed.status !== slip.status) {
    return `engine says "${computed.status}", ticket says "${slip.status}"`;
  }
  const computedPayout = "payoutPhp" in computed ? computed.payoutPhp : 0;
  if (Math.abs(computedPayout - slip.payoutPhp) > 0.005) {
    return `engine pays ${computedPayout.toFixed(2)}, ticket says ${slip.payoutPhp.toFixed(2)}`;
  }
  return null;
}

async function loadFights(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<Map<string, FightRow>> {
  const ids = [...new Set(OWNER_SLIP_SEED.flatMap((s) => s.legs.map((l) => l.fightId).filter((id): id is string => id !== null)))];
  const { data, error } = await supabase.from("fights").select("id, fighter1_id, fighter2_id").in("id", ids);
  if (error) throw error;
  return new Map(((data ?? []) as FightRow[]).map((f) => [f.id, f]));
}

/**
 * The check that matters most. A ticket's W1/W2 does NOT reliably map to
 * the database's fighter1/fighter2 -- at least one real slip is stored in
 * the opposite order -- so every selection is verified to actually belong
 * to the fight it was mapped onto. The bet_legs trigger enforces the same
 * rule, but only at write time and only per row; failing the whole run up
 * front is what keeps a half-written backfill from happening.
 */
function validate(fights: Map<string, FightRow>): string[] {
  const problems: string[] = [];

  for (const slip of OWNER_SLIP_SEED) {
    const label = slip.bookmakerBetId ?? `${slip.placedAt} / P${slip.stakePhp}`;

    const mismatch = crossCheckAgainstEngine(slip);
    if (mismatch) problems.push(`slip ${label}: ${mismatch}`);

    for (const leg of slip.legs) {
      if (leg.fightId === null) {
        if (leg.externalDescription === null) problems.push(`slip ${label}: leg has neither fightId nor description`);
        continue;
      }
      const fight = fights.get(leg.fightId);
      if (!fight) {
        problems.push(`slip ${label}: fight ${leg.fightId} not found`);
        continue;
      }
      if (leg.selectionFighterId !== null) {
        const belongs = leg.selectionFighterId === fight.fighter1_id || leg.selectionFighterId === fight.fighter2_id;
        if (!belongs) {
          problems.push(
            `slip ${label}: fighter ${leg.selectionFighterId} is NOT in fight ${leg.fightId} ` +
              `(that fight is ${fight.fighter1_id} vs ${fight.fighter2_id})`,
          );
        }
      }
    }
  }
  return problems;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const supabase = getSupabaseAdmin();

  console.log(apply ? "=== APPLY ===\n" : "=== DRY RUN (pass --apply to write) ===\n");

  const fights = await loadFights(supabase);
  const problems = validate(fights);
  if (problems.length > 0) {
    console.error(`REFUSING TO PROCEED -- ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`Validated ${OWNER_SLIP_SEED.length} slips: every selection belongs to its fight, and every`);
  console.log("printed payout is reproduced by settleSlip.\n");

  const { data: existingRows, error: existingError } = await supabase
    .from("bet_slips")
    .select("bookmaker_bet_id, placed_at, stake_php");
  if (existingError) throw existingError;
  const existingIds = new Set(
    (existingRows ?? []).map((r) => r.bookmaker_bet_id as string | null).filter((v): v is string => v !== null),
  );
  const existingFallback = new Set(
    (existingRows ?? []).map((r) => `${new Date(r.placed_at as string).toISOString()}|${Number(r.stake_php)}`),
  );

  let staked = 0;
  let returned = 0;
  let toInsert = 0;
  let skipped = 0;

  for (const slip of OWNER_SLIP_SEED) {
    const label = slip.bookmakerBetId ?? "(no ticket no.)";
    const already =
      slip.bookmakerBetId !== null
        ? existingIds.has(slip.bookmakerBetId)
        : existingFallback.has(`${new Date(slip.placedAt).toISOString()}|${slip.stakePhp}`);

    staked += slip.stakePhp;
    returned += slip.payoutPhp;

    if (already) {
      skipped++;
      console.log(`  SKIP  ${label.padEnd(14)} already recorded`);
      continue;
    }
    toInsert++;
    const pnl = slip.payoutPhp - slip.stakePhp;
    console.log(
      `  ADD   ${label.padEnd(14)} ${slip.archetype.padEnd(13)} ${slip.legs.length} leg(s)  ` +
        `P${slip.stakePhp.toFixed(2).padStart(8)} @ ${String(slip.combinedPrice).padStart(7)}  ` +
        `${slip.status.padEnd(5)}  pnl ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`,
    );

    if (!apply) continue;

    const { data: inserted, error: slipError } = await supabase
      .from("bet_slips")
      .insert({
        event_id: slip.eventId,
        author: "USER",
        user_id: OWNER_USER_ID,
        archetype: slip.archetype,
        stake_php: slip.stakePhp,
        stake_units: unitsFor(slip.stakePhp),
        book: "1xbet-style PH book",
        bookmaker_bet_id: slip.bookmakerBetId,
        is_promo: slip.isPromo ?? false,
        combined_price: slip.combinedPrice,
        status: slip.status,
        payout_php: slip.payoutPhp,
        placed_at: slip.placedAt,
        settled_at: slip.placedAt,
        note: slip.note ?? null,
      })
      .select("id")
      .single();
    if (slipError) throw slipError;

    const slipId = inserted.id as string;
    const { error: legsError } = await supabase.from("bet_legs").insert(
      slip.legs.map((leg) => ({
        slip_id: slipId,
        fight_id: leg.fightId,
        external_description: leg.externalDescription,
        market: leg.market,
        selection_fighter_id: leg.selectionFighterId,
        selection_detail: leg.selectionDetail,
        method_group: leg.methodGroup,
        price: leg.price,
        leg_result: leg.legResult,
        settled_at: leg.legResult === "pending" ? null : slip.placedAt,
      })),
    );
    if (legsError) throw legsError;
    // Deliberately no bankroll_ledger row here -- user-confirmed
    // 2026-09-21: these 16 tickets are reference material, not live
    // bankroll history. The slip/leg rows exist for the archetype and
    // INTERN-comparison boards; the bankroll itself starts clean.
  }

  const { count: ledgerCount, error: countError } = await supabase
    .from("bankroll_ledger")
    .select("id", { count: "exact", head: true })
    .eq("kind", "deposit");
  if (countError) throw countError;

  const needsOpening = (ledgerCount ?? 0) === 0;
  console.log(
    `\n  ${needsOpening ? "ADD" : "SKIP"}   opening bankroll deposit  P${OPENING_BANKROLL_PHP.toFixed(2)} @ ${OPENING_BANKROLL_AT}`,
  );
  if (apply && needsOpening) {
    const { error } = await supabase.from("bankroll_ledger").insert({
      kind: "deposit",
      amount_php: OPENING_BANKROLL_PHP,
      occurred_at: OPENING_BANKROLL_AT,
      note: "Opening bankroll (1u = P100 = 1%)",
    });
    if (error) throw error;
  }

  const net = returned - staked;
  console.log("\n--- reference-material reconciliation (all 16 tickets, regardless of skips) ---");
  console.log(`  staked    P${staked.toFixed(2)}`);
  console.log(`  returned  P${returned.toFixed(2)}`);
  console.log(`  net       ${net >= 0 ? "+" : ""}P${net.toFixed(2)}   (ROI ${((net / staked) * 100).toFixed(1)}%)`);
  console.log(`  to insert: ${toInsert}, already present: ${skipped}`);
  console.log(
    "  This net is for the archetype/INTERN comparison only -- these tickets predate the journal",
  );
  console.log(
    `  and do NOT move the bankroll. Bankroll balance stays a flat P${OPENING_BANKROLL_PHP.toFixed(2)} opening deposit.`,
  );

  if (!apply) console.log("\nNothing was written. Re-run with --apply to commit.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
