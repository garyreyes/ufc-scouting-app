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
