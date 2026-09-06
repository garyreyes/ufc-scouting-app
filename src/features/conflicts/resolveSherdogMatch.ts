import type { LowConfidenceSherdogMatchConflict } from "./types";

export interface SherdogMatchResolution {
  // null when the owner rejected every candidate -- the fighter keeps a
  // null sherdog_id, exactly as it was before this conflict was raised.
  fightersUpdate: { sherdog_id: number; sherdog_checked_at: string } | null;
  conflictUpdate: { resolved_at: string; resolution: string };
}

/**
 * What to write for a low_confidence_sherdog_match resolution -- pure,
 * matching resolveFighterMatch.ts's convention. Takes `chosenSherdogId`
 * rather than trusting the snapshot's own top candidate: the review
 * queue exists precisely to let the owner override a guess the resolver
 * itself wasn't confident enough to auto-apply (a name-order swap, a
 * common surname).
 *
 * Unlike the API-Sports resolution, this writes only the integer id --
 * Sherdog identity does not carry reach/stance, and the fighter's height
 * and record come from the fighter-page fetch in J4/J5, not from the
 * search candidate.
 */
export function buildSherdogMatchResolution(
  conflict: LowConfidenceSherdogMatchConflict,
  chosenSherdogId: number | null,
  now: Date = new Date(),
): SherdogMatchResolution {
  const resolvedAt = now.toISOString();

  if (chosenSherdogId === null) {
    return {
      fightersUpdate: null,
      conflictUpdate: { resolved_at: resolvedAt, resolution: "no_match" },
    };
  }

  const chosen = conflict.details.candidates.find((c) => c.sherdogId === chosenSherdogId);
  if (!chosen) {
    throw new Error("Chosen candidate is not among this conflict's own snapshotted candidates");
  }

  return {
    fightersUpdate: { sherdog_id: chosen.sherdogId, sherdog_checked_at: resolvedAt },
    conflictUpdate: {
      resolved_at: resolvedAt,
      resolution: `matched_to_sherdog_id:${chosen.sherdogId}`,
    },
  };
}
