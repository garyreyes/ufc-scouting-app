export type StructuralDuplicateChoice = "merge" | "not_same_person";

export interface StructuralDuplicateResolution {
  conflictUpdate: { resolved_at: string; resolution: string };
}

/**
 * What to write for a structural_duplicate_fighters resolution -- pure,
 * identical shape to resolveSherdogIdCollision.ts. "merge" asserts the two
 * rows ARE the same real person: the actual merge_fighters() call happens
 * in actions.ts, BEFORE this runs, so there is nothing left for this
 * function to write to `fighters` -- only the conflict row itself.
 * "not_same_person" means the structural fold was a coincidence; both
 * fighter rows are left exactly as they were.
 */
export function buildStructuralDuplicateResolution(
  choice: StructuralDuplicateChoice,
  now: Date = new Date(),
): StructuralDuplicateResolution {
  return {
    conflictUpdate: {
      resolved_at: now.toISOString(),
      resolution: choice === "merge" ? "merged_fighters" : "not_same_person",
    },
  };
}
