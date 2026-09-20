import { namesLikelySamePerson } from "../text/namesLikelySamePerson";

export interface FighterForDupeCheck {
  id: string;
  name: string;
}

export interface StructuralDuplicatePair {
  fighterAId: string;
  fighterAName: string;
  fighterBId: string;
  fighterBName: string;
}

/**
 * I1 (ROADMAP_V2.md Phase P, Tier 3): every pair of fighters that fold to
 * the same person under the existing structural rules
 * (namesLikelySamePerson.ts) -- the sweep this project has never had
 * (PROJECT_FACTS.md: "A2's disputed-opponent detection only ever runs on
 * a live write"). Deliberately reuses namesLikelySamePerson unchanged,
 * not a new or looser rule -- it already excludes nicknames/short forms
 * on purpose (a genuine human judgment call), and this sweep must not
 * quietly widen that boundary.
 *
 * O(n^2) over the fighters table (~845 rows live -> ~356k comparisons),
 * already proven cheap in-process by P1's dry run over the same
 * population.
 *
 * `fighterAId` is always the lexicographically smaller id, so the same
 * real-world pair always produces the same dedupe key regardless of
 * which order the rows came back in.
 */
export function detectStructuralDuplicateFighters(
  fighters: FighterForDupeCheck[],
): StructuralDuplicatePair[] {
  const pairs: StructuralDuplicatePair[] = [];

  for (let i = 0; i < fighters.length; i++) {
    for (let j = i + 1; j < fighters.length; j++) {
      const a = fighters[i];
      const b = fighters[j];
      if (!namesLikelySamePerson(a.name, b.name)) continue;

      const [first, second] = a.id < b.id ? [a, b] : [b, a];
      pairs.push({
        fighterAId: first.id,
        fighterAName: first.name,
        fighterBId: second.id,
        fighterBName: second.name,
      });
    }
  }

  return pairs;
}
