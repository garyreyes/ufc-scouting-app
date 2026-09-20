import { describe, expect, it } from "vitest";
import { detectStructuralDuplicateFighters } from "./detectStructuralDuplicateFighters";

// I1 (ROADMAP_V2.md Phase P, Tier 3): the sweep this project has never had
// -- namesLikelySamePerson already exists and is proven safe (P1's dry run,
// 355,746 pairs, 0 false positives), but nothing walks the WHOLE fighters
// table with it outside of a live upsertFighter write. This is that walk.

describe("detectStructuralDuplicateFighters", () => {
  it("flags a name-order-swap pair (the Choi Doo-ho / Dooho Choi shape)", () => {
    const pairs = detectStructuralDuplicateFighters([
      { id: "a", name: "Choi Doo-ho" },
      { id: "b", name: "Dooho Choi" },
    ]);
    expect(pairs).toEqual([
      { fighterAId: "a", fighterAName: "Choi Doo-ho", fighterBId: "b", fighterBName: "Dooho Choi" },
    ]);
  });

  it("flags a missing-internal-space pair", () => {
    const pairs = detectStructuralDuplicateFighters([
      { id: "a", name: "Aoriqileng" },
      { id: "b", name: "Aori Qileng" },
    ]);
    expect(pairs).toHaveLength(1);
  });

  it("does NOT flag a nickname/short-form pair -- a genuine human judgment call, not structural", () => {
    const pairs = detectStructuralDuplicateFighters([
      { id: "a", name: "Wes Schultz" },
      { id: "b", name: "Wesley Schultz" },
    ]);
    expect(pairs).toEqual([]);
  });

  it("does NOT flag two genuinely different fighters", () => {
    const pairs = detectStructuralDuplicateFighters([
      { id: "a", name: "Dan Hooker" },
      { id: "b", name: "Justin Gaethje" },
    ]);
    expect(pairs).toEqual([]);
  });

  it("always orders the pair by id, regardless of input order", () => {
    const pairs = detectStructuralDuplicateFighters([
      { id: "z", name: "Dooho Choi" },
      { id: "a", name: "Choi Doo-ho" },
    ]);
    expect(pairs).toEqual([
      { fighterAId: "a", fighterAName: "Choi Doo-ho", fighterBId: "z", fighterBName: "Dooho Choi" },
    ]);
  });

  it("checks every pair, not just adjacent ones", () => {
    const pairs = detectStructuralDuplicateFighters([
      { id: "a", name: "Dan Hooker" },
      { id: "b", name: "Justin Gaethje" },
      { id: "c", name: "Hooker Dan" },
    ]);
    expect(pairs).toEqual([
      { fighterAId: "a", fighterAName: "Dan Hooker", fighterBId: "c", fighterBName: "Hooker Dan" },
    ]);
  });
});
