import { stripNullish } from "@/lib/ufc-data-sync/stripNullish";
import type { LowConfidenceFighterMatchConflict } from "./types";

export interface FighterMatchResolution {
  // null when the owner rejected every candidate -- nothing to write
  // onto the fighter row. It stays unenriched, same as it was before
  // this conflict was ever raised.
  fightersUpdate: Record<string, unknown> | null;
  conflictUpdate: { resolved_at: string; resolution: string };
}

/**
 * What to write for a low_confidence_fighter_match resolution -- pure,
 * matching resolveDisputedOpponent.ts/resolveLowConfidence.ts's
 * convention. Takes `chosenExternalId` rather than trusting
 * conflict.details' own top-ranked candidate: the whole point of this
 * review queue is letting the owner override a guess the algorithm
 * itself wasn't confident enough to auto-apply.
 *
 * Reuses stripNullish exactly as the automatic enrichFighters.ts path
 * does, so a manual resolution writes an identical shape to what
 * auto-matching would have, had this candidate scored high enough to
 * skip the queue.
 */
export function buildFighterMatchResolution(
  conflict: LowConfidenceFighterMatchConflict,
  chosenExternalId: string | null,
  now: Date = new Date(),
): FighterMatchResolution {
  const resolvedAt = now.toISOString();

  if (chosenExternalId === null) {
    return {
      fightersUpdate: null,
      conflictUpdate: { resolved_at: resolvedAt, resolution: "no_match" },
    };
  }

  const chosen = conflict.details.candidates.find((c) => c.externalId === chosenExternalId);
  if (!chosen) {
    throw new Error("Chosen candidate is not among this conflict's own snapshotted candidates");
  }

  const fightersUpdate = stripNullish({
    external_id: chosen.externalId,
    height_cm: chosen.heightCm,
    reach_cm: chosen.reachCm,
    weight_kg: chosen.weightKg,
    weight_class: chosen.weightClass,
    stance: chosen.stance,
    nickname: chosen.nickname,
    team: chosen.team,
    synced_at: resolvedAt,
  });

  return {
    fightersUpdate,
    conflictUpdate: { resolved_at: resolvedAt, resolution: `matched_to_external_id:${chosen.externalId}` },
  };
}
