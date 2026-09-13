import { stripNullish } from "@/lib/ufc-data-sync/stripNullish";
import type { DisputedOpponentConflict } from "./types";

// M3: "merge" means the owner is asserting the two candidates ARE the same
// real person. The actual fighter merge (which id survives, the six-table
// repoint) is an I/O operation -- src/features/conflicts/actions.ts calls
// mergeFighters() BEFORE this pure function ever runs for that choice, so
// by the time buildDisputedOpponentResolution sees "merge" the identity
// fix is already done; there is nothing left for this function to write
// to `fights` (the merge already repointed it generically), only the
// conflict row itself to resolve.
export type DisputedOpponentChoice = "existing" | "candidate" | "merge";

export interface DisputedOpponentResolution {
  // null when the existing row was confirmed correct -- nothing to
  // change on `fights`. Populated when the candidate was chosen: the
  // candidate never got its own row (upsertFight.ts falls into the
  // conflict branch instead of inserting), so "using the candidate" is
  // an update-in-place of the single kept row, not a swap between two.
  fightsUpdate: Record<string, unknown> | null;
  conflictUpdate: { resolved_at: string; resolution: string };
}

/**
 * What to write for a disputed_opponent resolution -- pure, so the actual
 * Server Action (features/conflicts/actions.ts) stays thin glue around
 * this, matching the pure/IO-separation convention used throughout
 * lib/odds and lib/ufc-data-sync. Reuses stripNullish exactly the way
 * upsertFight.ts's own normal-match path does, so a resolution behaves
 * identically to what upserting the candidate directly would have done,
 * had it not hit the conflict branch.
 */
export function buildDisputedOpponentResolution(
  conflict: DisputedOpponentConflict,
  choice: DisputedOpponentChoice,
  now: Date = new Date(),
): DisputedOpponentResolution {
  const resolvedAt = now.toISOString();

  if (choice === "existing") {
    return {
      fightsUpdate: null,
      conflictUpdate: { resolved_at: resolvedAt, resolution: "confirmed_existing" },
    };
  }

  if (choice === "merge") {
    return {
      fightsUpdate: null,
      conflictUpdate: { resolved_at: resolvedAt, resolution: "merged_fighters" },
    };
  }

  const { candidate_external_id: _candidateExternalId, candidate_fighter1_id, candidate_fighter2_id, ...optional } =
    conflict.details;
  void _candidateExternalId; // never written -- the kept row keeps its own identity

  const fightsUpdate = stripNullish({
    fighter1_id: candidate_fighter1_id,
    fighter2_id: candidate_fighter2_id,
    ...optional,
  });

  return {
    fightsUpdate,
    conflictUpdate: { resolved_at: resolvedAt, resolution: "used_candidate" },
  };
}
