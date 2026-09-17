import { isSameCardNameVariant } from "./isSameCardNameVariant";

export interface MergeCandidateFighter {
  id: string;
  name: string;
  external_id: string | null;
  sherdog_id: number | null;
}

function pickMergeKeeper(a: MergeCandidateFighter, b: MergeCandidateFighter): MergeCandidateFighter {
  if (a.external_id !== null && b.external_id === null) return a;
  if (b.external_id !== null && a.external_id === null) return b;
  return a.id < b.id ? a : b;
}

export type MergeGuardResult =
  | { allowed: true; keepId: string; dropId: string }
  | { allowed: false; reason: "conflicting_sherdog_ids" };

/**
 * M3: the one hard, non-overridable guard on any fighter merge -- manual
 * (an owner clicking "same fighter" at /conflicts) or automatic (the
 * same-card-variant sweep). Two fighters carrying two DIFFERENT confirmed
 * Sherdog identities are definitionally not the same person; merging them
 * would permanently corrupt Sherdog-sourced data (finish stats, career
 * record) for whichever one gets dropped. A human who still believes it's
 * a data error should fix the Sherdog link first, not force a merge
 * through it.
 *
 * When allowed, also decides which side survives: the fighter carrying an
 * `external_id` (the identity API-Sports' results sync and Sherdog both
 * key on), tie-broken by the lower `id` -- the same deterministic rule
 * `upsertFighter.ts`'s own fold-match branch already uses, so a merge
 * lands on the same row future syncs would have picked anyway.
 */
export function checkMergeGuard(a: MergeCandidateFighter, b: MergeCandidateFighter): MergeGuardResult {
  if (a.sherdog_id !== null && b.sherdog_id !== null && a.sherdog_id !== b.sherdog_id) {
    return { allowed: false, reason: "conflicting_sherdog_ids" };
  }
  const keeper = pickMergeKeeper(a, b);
  const drop = keeper.id === a.id ? b : a;
  return { allowed: true, keepId: keeper.id, dropId: drop.id };
}

export type AutoMergeDecision =
  | { eligible: true; keepId: string; dropId: string }
  | { eligible: false; reason: "not_a_variant" | "conflicting_sherdog_ids" };

/**
 * The AUTOMATIC sweep's own additional gate on top of checkMergeGuard: it
 * may only ever fire for a recognized same-card name variant
 * (isSameCardNameVariant.ts) -- never a bare nickname, never two
 * genuinely different fighters. A manual owner-triggered merge is a
 * stronger signal and skips this gate, going straight to checkMergeGuard.
 */
export function decideAutoMerge(a: MergeCandidateFighter, b: MergeCandidateFighter): AutoMergeDecision {
  if (!isSameCardNameVariant(a.name, b.name)) return { eligible: false, reason: "not_a_variant" };
  const guard = checkMergeGuard(a, b);
  if (!guard.allowed) return { eligible: false, reason: guard.reason };
  return { eligible: true, keepId: guard.keepId, dropId: guard.dropId };
}
