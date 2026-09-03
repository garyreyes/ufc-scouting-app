import { describe, expect, it } from "vitest";
import { buildFighterMatchResolution } from "./resolveFighterMatch";
import type { LowConfidenceFighterMatchConflict } from "./types";

function conflict(): LowConfidenceFighterMatchConflict {
  return {
    id: "conflict-1",
    kind: "low_confidence_fighter_match",
    fightId: null,
    detectedAt: "2026-09-03T00:00:00Z",
    details: {
      fighterId: "fighter-1",
      storedName: "Jon Jones",
      candidates: [
        {
          externalId: "42",
          name: "Jon Jones",
          confidence: 1,
          heightCm: 193,
          reachCm: 215,
          weightKg: 93,
          weightClass: "Heavyweight",
          stance: "Orthodox",
          nickname: "Bones",
          team: "Jackson Wink MMA",
        },
        {
          externalId: "99",
          name: "John Jonas",
          confidence: 0.6,
          heightCm: null,
          reachCm: null,
          weightKg: null,
          weightClass: null,
          stance: null,
          nickname: null,
          team: null,
        },
      ],
    },
  };
}

describe("buildFighterMatchResolution", () => {
  it("writes the chosen candidate's full record onto the fighter row", () => {
    const result = buildFighterMatchResolution(conflict(), "42", new Date("2026-09-03T12:00:00Z"));
    expect(result.fightersUpdate).toEqual({
      external_id: "42",
      height_cm: 193,
      reach_cm: 215,
      weight_kg: 93,
      weight_class: "Heavyweight",
      stance: "Orthodox",
      nickname: "Bones",
      team: "Jackson Wink MMA",
      synced_at: "2026-09-03T12:00:00.000Z",
    });
  });

  // A candidate with real gaps (the actual production shape for a lower-
  // ranked, less-confident guess) must not blank out anything -- same
  // "never write a field this source doesn't actually know" rule
  // upsertFighter.ts's stripNullish already applies everywhere else.
  it("omits fields the chosen candidate doesn't have data for", () => {
    const result = buildFighterMatchResolution(conflict(), "99", new Date("2026-09-03T12:00:00Z"));
    expect(result.fightersUpdate).toEqual({
      external_id: "99",
      synced_at: "2026-09-03T12:00:00.000Z",
    });
  });

  it("marks the conflict resolved, naming which external id was chosen", () => {
    const result = buildFighterMatchResolution(conflict(), "42", new Date("2026-09-03T12:00:00Z"));
    expect(result.conflictUpdate.resolved_at).toBe("2026-09-03T12:00:00.000Z");
    expect(result.conflictUpdate.resolution).toContain("42");
  });

  // "None of these" -- the owner rejecting every candidate. Must not
  // silently pick the top-ranked guess just because SOME answer is
  // expected; the whole point of a review queue is that the algorithm
  // was not confident enough to be trusted alone.
  it("writes nothing onto the fighter when the owner rejects every candidate", () => {
    const result = buildFighterMatchResolution(conflict(), null, new Date("2026-09-03T12:00:00Z"));
    expect(result.fightersUpdate).toBeNull();
    expect(result.conflictUpdate.resolution).toBe("no_match");
  });

  it("refuses to write a candidate that isn't actually one of this conflict's own", () => {
    expect(() => buildFighterMatchResolution(conflict(), "does-not-exist")).toThrow();
  });
});
