import type { ClaimCheck, VerificationResult } from "./types";

/**
 * Runs every check against every claim and keeps only what survives all
 * of them -- the generalized shape of what parseClusterResponse.ts
 * already does by hand today (fighter resolves, category is real,
 * sourceUris exist). A check may narrow the claim (strip a field) rather
 * than just keep/drop it, which is how parseClusterResponse's sourceUris
 * filter generalizes: drop the fake URIs, keep the flag if any real ones
 * remain.
 *
 * Order matters for narrowing: each check runs against the PREVIOUS
 * check's (possibly narrowed) claim, not the original -- so a later check
 * that inspects a field an earlier check stripped will not see it. Checks
 * should be ordered narrowest-dependency-first for that reason.
 */
export function verifyClaims<TClaim, TFacts>(
  claims: TClaim[],
  facts: TFacts,
  checks: ClaimCheck<TClaim, TFacts>[],
): VerificationResult<TClaim> {
  const kept: TClaim[] = [];
  const dropReasons: Record<string, number> = {};
  let droppedCount = 0;

  for (const original of claims) {
    let claim = original;
    let dropped = false;

    for (const check of checks) {
      const result = check(claim, facts);
      if (!result.ok) {
        dropReasons[result.reason] = (dropReasons[result.reason] ?? 0) + 1;
        droppedCount++;
        dropped = true;
        break;
      }
      claim = result.claim;
    }

    if (!dropped) kept.push(claim);
  }

  return { kept, droppedCount, dropReasons };
}
