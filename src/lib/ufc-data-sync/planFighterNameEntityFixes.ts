import { decodeHtmlEntities } from "../text/decodeHtmlEntities";

export interface FighterNameRow {
  id: string;
  name: string;
}

export interface FighterNameFixPlan {
  id: string;
  before: string;
  after: string;
  // True when another EXISTING fighter row already holds the decoded
  // name (case-insensitively -- matching upsertFighter.ts's own `ilike`
  // convention). Renaming this row would silently create/reveal a
  // duplicate-fighter pair, exactly the class of bug RETROSPECTIVE.md
  // entry #9 describes -- so a colliding row is reported, never
  // auto-renamed. That pair needs the real `merge_fighters()` path,
  // decided by a human, not a blind UPDATE from this cleanup pass.
  collidesWithExistingFighter: boolean;
}

/**
 * RETROSPECTIVE.md entry #9's one-time backfill: `upsertFighter.ts` and
 * the Sherdog parsers now decode HTML entities going forward, but
 * existing production rows written before that fix (e.g. "Casey
 * O&#x27;Neill") stay polluted until something rewrites them. Pure
 * decision function -- `runFixFighterNameEntities.ts` does the actual
 * read/write and dry-run gating.
 */
export function planFighterNameEntityFixes(fighters: FighterNameRow[]): FighterNameFixPlan[] {
  // Compare every row's DECODED name, not its raw one -- two still-
  // polluted duplicate rows (e.g. one stored with a hex apostrophe entity,
  // another with the decimal form for the same person) both decode to the
  // identical clean name without either row's RAW name ever matching the
  // other's decoded name. Comparing raw-vs-decoded would miss that pair
  // entirely and rename both into an undetected duplicate.
  const decodedByFighter = new Map(fighters.map((f) => [f.id, decodeHtmlEntities(f.name)]));

  const plans: FighterNameFixPlan[] = [];
  for (const fighter of fighters) {
    const decoded = decodedByFighter.get(fighter.id)!;
    if (decoded === fighter.name) continue;

    const decodedLower = decoded.toLowerCase();
    const collidesWithExistingFighter = fighters.some(
      (other) => other.id !== fighter.id && decodedByFighter.get(other.id)!.toLowerCase() === decodedLower,
    );

    plans.push({ id: fighter.id, before: fighter.name, after: decoded, collidesWithExistingFighter });
  }
  return plans;
}
