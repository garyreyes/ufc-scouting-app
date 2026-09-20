import { describe, expect, it } from "vitest";
import { buildSherdogIdCollisionResolution } from "./resolveSherdogIdCollision";

// P6 (ROADMAP_V2.md): the owner's two choices on a sherdog_id_collision --
// "merge" asserts the two fighter rows are one real person (the actual
// merge_fighters() call happens in actions.ts, before this runs, same
// split resolveDisputedOpponent.ts's own "merge" choice uses); "not_same_
// person" means the search matched the wrong page, and both fighter rows
// are left exactly as they were.
describe("buildSherdogIdCollisionResolution", () => {
  it("resolves with resolution='merged_fighters' for the merge choice", () => {
    const resolution = buildSherdogIdCollisionResolution("merge", new Date("2026-09-20T12:00:00Z"));
    expect(resolution.conflictUpdate).toEqual({
      resolved_at: "2026-09-20T12:00:00.000Z",
      resolution: "merged_fighters",
    });
  });

  it("resolves with resolution='not_same_person' for the reject choice", () => {
    const resolution = buildSherdogIdCollisionResolution("not_same_person", new Date("2026-09-20T12:00:00Z"));
    expect(resolution.conflictUpdate).toEqual({
      resolved_at: "2026-09-20T12:00:00.000Z",
      resolution: "not_same_person",
    });
  });
});
