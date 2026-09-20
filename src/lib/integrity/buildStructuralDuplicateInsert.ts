import type { StructuralDuplicatePair } from "./detectStructuralDuplicateFighters";

export interface StructuralDuplicateInsert {
  kind: "structural_duplicate_fighters";
  fight_id: null;
  details: {
    fighterAId: string;
    fighterAName: string;
    fighterBId: string;
    fighterBName: string;
  };
}

/**
 * The data_conflicts row for an I1 violation -- pure, matching the
 * buildXInsert convention lib/sherdog/buildSherdogIdentityWrites.ts
 * already established.
 */
export function buildStructuralDuplicateInsert(pair: StructuralDuplicatePair): StructuralDuplicateInsert {
  return {
    kind: "structural_duplicate_fighters",
    fight_id: null,
    details: {
      fighterAId: pair.fighterAId,
      fighterAName: pair.fighterAName,
      fighterBId: pair.fighterBId,
      fighterBName: pair.fighterBName,
    },
  };
}
