import type { SherdogSearchCandidate } from "./parseSearch";
import type { LowConfidenceReason, RankedSherdogCandidate } from "./resolveSherdogIdentity";

// The two write payloads the identity job produces, pulled out pure so
// their shape is tested rather than buried in the Supabase orchestration
// -- same split enrichFighters.ts/resolveFighterMatch.ts use.

export interface SherdogIdentityUpdate {
  sherdog_id: number;
  sherdog_checked_at: string;
}

/** What to write onto a fighters row for an auto-matched, guard-passed id. */
export function buildSherdogIdentityUpdate(sherdogId: number, checkedAt: string): SherdogIdentityUpdate {
  return { sherdog_id: sherdogId, sherdog_checked_at: checkedAt };
}

export interface SherdogConflictInsert {
  kind: "low_confidence_sherdog_match";
  fight_id: null;
  details: {
    fighterId: string;
    storedName: string;
    // Why this landed in the queue -- 'below_threshold', 'ambiguous'
    // (two+ candidates share the name), or 'guard_mismatch' (auto-match
    // fired but the fetched page was a different person). Drives the
    // card's explanation so the owner knows what they're disambiguating.
    reason: LowConfidenceReason | "guard_mismatch";
    // Only set when reason is 'guard_mismatch': the name on the page the
    // auto-match would have written, so the owner sees exactly what was
    // caught rather than re-confirming it.
    guardMismatchPageName?: string;
    candidates: Array<{
      sherdogId: number;
      name: string;
      confidence: number;
      nickname: string | null;
      heightImperial: string | null;
      weightImperial: string | null;
      association: string | null;
    }>;
  };
}

/**
 * The data_conflicts row for a low-confidence Sherdog match. Merges the
 * ranked confidence scores back onto the full candidate objects so the
 * review screen has both the score and every distinguishing detail
 * (nickname, listed height/weight, gym) in one snapshot -- the owner
 * needs those to tell two "Andre Lima"s apart. Ordered best-first.
 */
export interface SherdogIdCollisionInsert {
  kind: "sherdog_id_collision";
  fight_id: null;
  details: {
    fighterId: string;
    storedName: string;
    sherdogId: number;
    existingFighterId: string;
    existingFighterName: string;
  };
}

/**
 * P6 (ROADMAP_V2.md): fighters.sherdog_id is UNIQUE (0036) -- a write
 * colliding with an already-claimed id is proof, not a guess, that this
 * fighter and the existing owner are one real person (or, more rarely,
 * that this fighter's own search matched the wrong page). Structurally
 * stronger than every other signal this job produces, since no name
 * comparison is involved at all -- previously this just fell through to
 * the job's generic catch block and was counted as a plain `failed`,
 * discarding the strongest duplicate-detection signal the schema can
 * produce. This is the review proposal that replaces that silent loss.
 */
export function buildSherdogIdCollisionInsert(
  fighterId: string,
  storedName: string,
  sherdogId: number,
  existingFighterId: string,
  existingFighterName: string,
): SherdogIdCollisionInsert {
  return {
    kind: "sherdog_id_collision",
    fight_id: null,
    details: { fighterId, storedName, sherdogId, existingFighterId, existingFighterName },
  };
}

export function buildSherdogConflictInsert(
  fighterId: string,
  storedName: string,
  ranked: RankedSherdogCandidate[],
  candidates: SherdogSearchCandidate[],
  reason: LowConfidenceReason | "guard_mismatch",
  guardMismatchPageName?: string,
): SherdogConflictInsert {
  const bySherdogId = new Map(candidates.map((c) => [c.sherdogId, c]));
  return {
    kind: "low_confidence_sherdog_match",
    fight_id: null,
    details: {
      fighterId,
      storedName,
      reason,
      ...(guardMismatchPageName ? { guardMismatchPageName } : {}),
      candidates: ranked.map((r) => {
        const c = bySherdogId.get(r.sherdogId);
        return {
          sherdogId: r.sherdogId,
          name: r.name,
          confidence: r.confidence,
          nickname: c?.nickname ?? null,
          heightImperial: c?.heightImperial ?? null,
          weightImperial: c?.weightImperial ?? null,
          association: c?.association ?? null,
        };
      }),
    },
  };
}
