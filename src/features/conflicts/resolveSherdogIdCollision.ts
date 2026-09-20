export type SherdogIdCollisionChoice = "merge" | "not_same_person";

export interface SherdogIdCollisionResolution {
  conflictUpdate: { resolved_at: string; resolution: string };
}

/**
 * What to write for a sherdog_id_collision resolution -- pure, matching
 * resolveDisputedOpponent.ts's own convention. "merge" asserts the two
 * fighter rows ARE the same real person: the actual merge_fighters() call
 * happens in actions.ts, BEFORE this runs (same split disputed_opponent's
 * "merge" choice already uses), so there is nothing left for this
 * function to write to `fighters` -- only the conflict row itself.
 * "not_same_person" means the search matched the wrong page; both fighter
 * rows are left exactly as they were (the fighter that lost the write
 * stays sherdog_id null, and its sherdog_checked_at was already stamped
 * when the collision was detected, so it will not be auto-retried).
 */
export function buildSherdogIdCollisionResolution(
  choice: SherdogIdCollisionChoice,
  now: Date = new Date(),
): SherdogIdCollisionResolution {
  return {
    conflictUpdate: {
      resolved_at: now.toISOString(),
      resolution: choice === "merge" ? "merged_fighters" : "not_same_person",
    },
  };
}
