import { getSupabaseAdmin } from "../supabase/admin";
import { selectAllPages } from "../supabase/selectAllPages";
import { planFighterNameEntityFixes } from "./planFighterNameEntityFixes";
import type { FighterNameRow } from "./planFighterNameEntityFixes";

// RETROSPECTIVE.md entry #9's one-time backfill. `upsertFighter.ts` and
// the Sherdog parsers now decode HTML entities going forward
// (2026-09-20), but rows written before that fix stay polluted until
// something rewrites them -- this project's own bulk-mutation rule
// (PROJECT_FACTS.md/feature-planner) requires a dry-run and an explicit
// go-ahead before any such write touches production, so `--dry-run` is
// the default expectation for the FIRST run, matching
// `runResolveSameCardNameVariantsJob.ts`'s exact convention.
//
//   npm run fighters:fix-name-entities -- --dry-run   (read-only, prints the plan)
//   npm run fighters:fix-name-entities                (writes the safe renames)
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const supabase = getSupabaseAdmin();

  // M1: paged, not a bare `.select()` -- see upsertFighter.ts's own fold-
  // match scan for why a plain select silently truncates at PostgREST's
  // row cap on this table.
  const fighters = await selectAllPages<FighterNameRow>(supabase, "fighters", "id, name");
  const plans = planFighterNameEntityFixes(fighters);

  const safe = plans.filter((p) => !p.collidesWithExistingFighter);
  const colliding = plans.filter((p) => p.collidesWithExistingFighter);

  console.log(
    `Fighter name entity fix${dryRun ? " (DRY RUN — nothing written)" : ""}: ` +
      `${fighters.length} fighters read, ${plans.length} polluted name(s) found, ` +
      `${safe.length} safe to rename, ${colliding.length} colliding (needs a manual merge_fighters() review).`,
  );

  for (const plan of plans) {
    const tag = plan.collidesWithExistingFighter ? "COLLISION -- skipped, review manually" : "rename";
    console.log(`  [${tag}] ${plan.id}: "${plan.before}" -> "${plan.after}"`);
  }

  if (dryRun || safe.length === 0) return;

  let renamed = 0;
  for (const plan of safe) {
    const { error } = await supabase.from("fighters").update({ name: plan.after }).eq("id", plan.id);
    if (error) throw error;
    renamed++;
  }
  console.log(`Renamed ${renamed} fighter(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
