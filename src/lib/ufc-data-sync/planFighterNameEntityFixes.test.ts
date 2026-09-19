import { describe, expect, it } from "vitest";
import { planFighterNameEntityFixes } from "./planFighterNameEntityFixes";
import type { FighterNameRow } from "./planFighterNameEntityFixes";

function fighter(overrides: Partial<FighterNameRow>): FighterNameRow {
  return { id: "id-1", name: "Someone", ...overrides };
}

describe("planFighterNameEntityFixes", () => {
  it("plans a safe rename when the decoded name collides with nothing else", () => {
    const plans = planFighterNameEntityFixes([fighter({ id: "1", name: "Casey O&#x27;Neill" })]);

    expect(plans).toEqual([
      { id: "1", before: "Casey O&#x27;Neill", after: "Casey O'Neill", collidesWithExistingFighter: false },
    ]);
  });

  it("returns nothing for a fighter whose name has no entity to decode", () => {
    const plans = planFighterNameEntityFixes([fighter({ id: "1", name: "Alexandre Pantoja" })]);
    expect(plans).toEqual([]);
  });

  it("flags a collision instead of planning a blind rename when another row already holds the decoded name", () => {
    const plans = planFighterNameEntityFixes([
      fighter({ id: "1", name: "Casey O&#x27;Neill" }),
      fighter({ id: "2", name: "Casey O'Neill" }),
    ]);

    expect(plans).toEqual([
      { id: "1", before: "Casey O&#x27;Neill", after: "Casey O'Neill", collidesWithExistingFighter: true },
    ]);
  });

  it("flags a collision case-insensitively, matching this codebase's own name-matching convention", () => {
    const plans = planFighterNameEntityFixes([
      fighter({ id: "1", name: "Casey O&#x27;Neill" }),
      fighter({ id: "2", name: "CASEY O'NEILL" }),
    ]);

    expect(plans[0].collidesWithExistingFighter).toBe(true);
  });

  it("plans two independent safe renames when both decode to distinct, non-colliding names", () => {
    const plans = planFighterNameEntityFixes([
      fighter({ id: "1", name: "Casey O&#x27;Neill" }),
      fighter({ id: "2", name: "Sean O&#39;Malley" }),
    ]);

    expect(plans).toHaveLength(2);
    expect(plans.every((p) => !p.collidesWithExistingFighter)).toBe(true);
  });

  it("never flags a fighter against itself as a collision", () => {
    // Only one row, decodes to something new -- nothing else exists to
    // collide with regardless of casing tricks.
    const plans = planFighterNameEntityFixes([fighter({ id: "1", name: "Don&#X27;Tale Mayes" })]);
    expect(plans[0].collidesWithExistingFighter).toBe(false);
  });

  it("returns [] on no input", () => {
    expect(planFighterNameEntityFixes([])).toEqual([]);
  });

  it("flags a collision between two STILL-POLLUTED rows that decode to the same name via different entity encodings", () => {
    // Hex vs. decimal apostrophe for the same person, both un-decoded --
    // neither row's RAW name equals the other's decoded name, so a
    // raw-vs-decoded comparison would miss this pair entirely.
    const plans = planFighterNameEntityFixes([
      fighter({ id: "1", name: "Jose O&#x27;Neill" }),
      fighter({ id: "2", name: "Jose O&#39;Neill" }),
    ]);

    expect(plans).toHaveLength(2);
    expect(plans.every((p) => p.collidesWithExistingFighter)).toBe(true);
  });
});
