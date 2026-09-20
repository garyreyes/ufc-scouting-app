import { describe, expect, it } from "vitest";
import { segmentCard } from "./segmentCard";

describe("segmentCard", () => {
  it("puts the 5 lowest bout_order fights in the main card, in order", () => {
    const fights = Array.from({ length: 13 }, (_, i) => ({ fightId: `f${i}`, boutOrder: i }));
    const result = segmentCard(fights);
    const main = result.filter((f) => f.segment === "main").map((f) => f.fightId);
    const prelims = result.filter((f) => f.segment === "prelims").map((f) => f.fightId);
    expect(main).toEqual(["f0", "f1", "f2", "f3", "f4"]);
    expect(prelims).toEqual(["f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12"]);
  });

  it("puts every fight in the main card when the whole card has 5 or fewer fights", () => {
    const fights = [
      { fightId: "f0", boutOrder: 0 },
      { fightId: "f1", boutOrder: 1 },
      { fightId: "f2", boutOrder: 2 },
    ];
    const result = segmentCard(fights);
    expect(result.every((f) => f.segment === "main")).toBe(true);
  });

  it("sorts null bout_order fights last, so they land in prelims rather than being excluded", () => {
    const fights = [
      { fightId: "main-event", boutOrder: 0 },
      { fightId: "co-main", boutOrder: 1 },
      { fightId: "f2", boutOrder: 2 },
      { fightId: "f3", boutOrder: 3 },
      { fightId: "f4", boutOrder: 4 },
      { fightId: "unmatched", boutOrder: null },
      { fightId: "f6", boutOrder: 6 },
    ];
    const result = segmentCard(fights);
    const unmatched = result.find((f) => f.fightId === "unmatched");
    expect(unmatched?.segment).toBe("prelims");
    // Still counted -- present in the output, not dropped.
    expect(result).toHaveLength(7);
  });

  it("returns an empty array for an empty card", () => {
    expect(segmentCard([])).toEqual([]);
  });
});
