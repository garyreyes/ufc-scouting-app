import { describe, expect, it } from "vitest";
import { clusterFightsBySharedFighter } from "./clusterFightsBySharedFighter";

function fight(id: string, fighter1_id: string, fighter2_id: string) {
  return { id, fighter1_id, fighter2_id };
}

describe("clusterFightsBySharedFighter", () => {
  it("returns nothing when no two fights share exactly one fighter", () => {
    const fights = [fight("1", "a", "b"), fight("2", "c", "d")];
    expect(clusterFightsBySharedFighter(fights)).toEqual([]);
  });

  it("groups two fights sharing exactly one fighter into one cluster", () => {
    const fights = [fight("1", "batbayar", "orphan-lima"), fight("2", "enriched-lima", "batbayar")];
    const clusters = clusterFightsBySharedFighter(fights);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].sort()).toEqual(["1", "2"]);
  });

  // The real production case (I2c, 2026-09-03): "Gauge Young" appears
  // across THREE fight rows on one card, only two of which are actually
  // the same bout under a nickname variant (Stan/Stanley Dorsainvil) --
  // the third names a genuinely different opponent (Kody Steele). All
  // three still belong in one cluster: they're connected by shared
  // fighters even though not every pair in the cluster shares one
  // directly with every other.
  it("groups a chain of three fights into one cluster, not three separate pairs", () => {
    const fights = [
      fight("api", "dorsainvil", "young"),
      fight("wiki10", "young", "stanley-dorsainvil"),
      fight("wiki6", "steele", "young"),
    ];
    const clusters = clusterFightsBySharedFighter(fights);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].sort()).toEqual(["api", "wiki10", "wiki6"].sort());
  });

  // A "path" cluster: A-B share a fighter, B-C share a fighter, but A and
  // C share nothing directly (their own shared fighter has two different
  // ids -- exactly the "Liu Ce" / "Ce Liu" name-order case). Still one
  // connected component.
  it("connects a path cluster through a shared middle fight, even with no direct edge at the ends", () => {
    const fights = [fight("wiki4", "tafa", "liu-ce"), fight("api2812", "tafa", "ce-liu"), fight("api2933", "rodrigues", "ce-liu")];
    const clusters = clusterFightsBySharedFighter(fights);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].sort()).toEqual(["api2812", "api2933", "wiki4"].sort());
  });

  it("keeps two unrelated clusters on the same card separate", () => {
    const fights = [
      fight("1", "a", "b"),
      fight("2", "a-variant", "b"),
      fight("3", "x", "y"),
      fight("4", "x-variant", "y"),
    ];
    const clusters = clusterFightsBySharedFighter(fights);
    expect(clusters).toHaveLength(2);
    const sorted = clusters.map((c) => c.slice().sort()).sort();
    expect(sorted).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  // Two fights sharing BOTH fighters is a straightforward exact-pair
  // match (upsertFight.ts's own second branch, already handled long
  // before this ever runs) -- not this function's concern, and must not
  // be swept up as if it were a disputed-opponent case.
  it("does not cluster two fights that share both fighters", () => {
    const fights = [fight("1", "a", "b"), fight("2", "a", "b")];
    expect(clusterFightsBySharedFighter(fights)).toEqual([]);
  });

  // A cluster relies on checking every pair, not just adjacent array
  // entries -- fights arrive in whatever order the caller's own query
  // returned, never guaranteed to place related fights next to each
  // other. The two connected fights here sit at opposite ends of the
  // array with two unrelated ones between them.
  it("finds a connection between fights that are far apart in the input array, not just adjacent ones", () => {
    const fights = [
      fight("1", "batbayar", "orphan-lima"),
      fight("2", "unrelated-a", "unrelated-b"),
      fight("3", "unrelated-c", "unrelated-d"),
      fight("4", "enriched-lima", "batbayar"),
    ];
    const clusters = clusterFightsBySharedFighter(fights);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].sort()).toEqual(["1", "4"]);
  });

  it("ignores a fight with no real overlap with anything", () => {
    const fights = [fight("1", "batbayar", "orphan-lima"), fight("2", "enriched-lima", "batbayar"), fight("3", "someone", "else")];
    const clusters = clusterFightsBySharedFighter(fights);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].sort()).toEqual(["1", "2"]);
  });
});
