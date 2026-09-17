import { describe, it, expect } from "vitest";
import { orderSherdogIdsForReimport, type PendingFight } from "./orderSherdogIdsForReimport";

describe("orderSherdogIdsForReimport (M4)", () => {
  it("orders by event date, newest first", () => {
    const pending: PendingFight[] = [
      { fighter1_id: "a", fighter2_id: "b", eventDate: "2026-09-01" },
      { fighter1_id: "c", fighter2_id: "d", eventDate: "2026-09-15" },
    ];
    const sherdogIdByFighterId = new Map([
      ["a", 1],
      ["b", 2],
      ["c", 3],
      ["d", 4],
    ]);

    const result = orderSherdogIdsForReimport(pending, sherdogIdByFighterId, 10);

    // fighters from the 09-15 card (c, d -> 3, 4) come before the
    // 09-01 card's (a, b -> 1, 2).
    expect(result).toEqual([3, 4, 1, 2]);
  });

  it("when capped, keeps the newest card's fighters and drops the oldest -- the actual bug this fixes", () => {
    const pending: PendingFight[] = [
      { fighter1_id: "a", fighter2_id: "b", eventDate: "2026-09-01" },
      { fighter1_id: "c", fighter2_id: "d", eventDate: "2026-09-15" },
    ];
    const sherdogIdByFighterId = new Map([
      ["a", 1],
      ["b", 2],
      ["c", 3],
      ["d", 4],
    ]);

    // Capped at 2: previously (arbitrary Set order from an unordered DB
    // fetch) this could just as easily keep the OLDEST card's fighters
    // instead -- exactly backwards, since the newest card is the one
    // whose result is most likely still awaiting a Sherdog answer.
    const result = orderSherdogIdsForReimport(pending, sherdogIdByFighterId, 2);

    expect(result).toEqual([3, 4]);
  });

  it("counts a fighter on two pending fights once, at its newest occurrence", () => {
    const pending: PendingFight[] = [
      { fighter1_id: "a", fighter2_id: "b", eventDate: "2026-09-01" },
      { fighter1_id: "a", fighter2_id: "c", eventDate: "2026-09-15" },
    ];
    const sherdogIdByFighterId = new Map([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);

    const result = orderSherdogIdsForReimport(pending, sherdogIdByFighterId, 10);

    expect(result).toEqual([1, 3, 2]);
  });

  it("drops fighters with no linked sherdog id, without leaving a gap", () => {
    const pending: PendingFight[] = [{ fighter1_id: "a", fighter2_id: "b", eventDate: "2026-09-15" }];
    const sherdogIdByFighterId = new Map([
      ["a", 1],
      ["b", null],
    ]);

    const result = orderSherdogIdsForReimport(pending, sherdogIdByFighterId, 10);

    expect(result).toEqual([1]);
  });

  it("returns an empty list when nothing is pending", () => {
    expect(orderSherdogIdsForReimport([], new Map(), 10)).toEqual([]);
  });
});
