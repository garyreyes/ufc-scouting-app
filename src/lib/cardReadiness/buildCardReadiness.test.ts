import { describe, expect, it } from "vitest";
import { buildCardReadiness } from "./buildCardReadiness";

// P9 (ROADMAP_V2.md Phase P): the pre-card number, computed as pure
// arithmetic over already-fetched sets -- the DB reads live in
// getCardReadiness (features/job-health/api.ts), same split as every
// other detect*/select* function in this codebase.
describe("buildCardReadiness", () => {
  it("counts priced fights, Sherdog-linked fighters, and open conflicts for the card", () => {
    const readiness = buildCardReadiness(
      {
        eventName: "UFC 332",
        eventDate: "2026-10-03",
        fightIds: ["f1", "f2", "f3"],
        fighterIds: ["a", "b", "c", "d", "e", "g"],
        pricedFightIds: new Set(["f1", "f2", "not-on-this-card"]),
        sherdogCheckedFighterIds: new Set(["a", "b", "c", "d"]),
        openConflictCount: 0,
      },
      new Date("2026-09-27T00:00:00Z"),
    );

    expect(readiness).toEqual({
      eventName: "UFC 332",
      eventDate: "2026-10-03",
      daysUntil: 6,
      fightsTotal: 3,
      fightsPriced: 2,
      fightersTotal: 6,
      fightersSherdogLinked: 4,
      openConflicts: 0,
    });
  });

  it("reports zero daysUntil on the card's own event date", () => {
    const readiness = buildCardReadiness(
      {
        eventName: "UFC 332",
        eventDate: "2026-10-03",
        fightIds: [],
        fighterIds: [],
        pricedFightIds: new Set(),
        sherdogCheckedFighterIds: new Set(),
        openConflictCount: 0,
      },
      new Date("2026-10-03T18:00:00Z"),
    );

    expect(readiness.daysUntil).toBe(0);
  });

  it("does not count a priced fight from a different card", () => {
    const readiness = buildCardReadiness(
      {
        eventName: "UFC 332",
        eventDate: "2026-10-03",
        fightIds: ["f1"],
        fighterIds: ["a", "b"],
        pricedFightIds: new Set(["some-other-cards-fight"]),
        sherdogCheckedFighterIds: new Set(),
        openConflictCount: 0,
      },
      new Date("2026-09-27T00:00:00Z"),
    );

    expect(readiness.fightsPriced).toBe(0);
  });

  it("passes through a nonzero open conflict count unchanged", () => {
    const readiness = buildCardReadiness(
      {
        eventName: "UFC 332",
        eventDate: "2026-10-03",
        fightIds: ["f1"],
        fighterIds: ["a", "b"],
        pricedFightIds: new Set(),
        sherdogCheckedFighterIds: new Set(),
        openConflictCount: 3,
      },
      new Date("2026-09-27T00:00:00Z"),
    );

    expect(readiness.openConflicts).toBe(3);
  });
});
