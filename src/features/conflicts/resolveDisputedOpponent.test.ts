import { describe, expect, it } from "vitest";
import { buildDisputedOpponentResolution } from "./resolveDisputedOpponent";
import type { DisputedOpponentConflict } from "./types";

const NOW = new Date("2026-09-05T00:00:00Z");

function conflict(overrides: Partial<DisputedOpponentConflict["details"]> = {}): DisputedOpponentConflict {
  return {
    id: "conflict-1",
    kind: "disputed_opponent",
    fightId: "kept-fight-1",
    detectedAt: "2026-09-01T00:00:00Z",
    details: {
      candidate_external_id: "wiki:UFC 331:9",
      candidate_fighter1_id: "fighter-a",
      candidate_fighter2_id: "fighter-c", // the disputed replacement opponent
      winner_id: null,
      method: null,
      round: null,
      weight_class: "Lightweight",
      bout_order: 3,
      ...overrides,
    },
  };
}

describe("buildDisputedOpponentResolution", () => {
  it("confirming the existing row writes no fights update, only resolves the conflict", () => {
    const result = buildDisputedOpponentResolution(conflict(), "existing", NOW);
    expect(result.fightsUpdate).toBeNull();
    expect(result.conflictUpdate).toEqual({
      resolved_at: "2026-09-05T00:00:00.000Z",
      resolution: "confirmed_existing",
    });
  });

  it("using the candidate writes the candidate's fighter ids onto the kept fight", () => {
    const result = buildDisputedOpponentResolution(conflict(), "candidate", NOW);
    expect(result.fightsUpdate).toMatchObject({
      fighter1_id: "fighter-a",
      fighter2_id: "fighter-c",
    });
    expect(result.conflictUpdate).toEqual({
      resolved_at: "2026-09-05T00:00:00.000Z",
      resolution: "used_candidate",
    });
  });

  it("using the candidate carries over non-null optional fields (weight_class, bout_order) too", () => {
    const result = buildDisputedOpponentResolution(conflict(), "candidate", NOW);
    expect(result.fightsUpdate).toMatchObject({ weight_class: "Lightweight", bout_order: 3 });
  });

  it("using the candidate drops null optional fields rather than overwriting good data with nothing", () => {
    // winner_id/method/round are null on the candidate (unknown) -- the
    // kept row may already have real values for them from the OTHER
    // source, which a blind overwrite would destroy.
    const result = buildDisputedOpponentResolution(conflict(), "candidate", NOW);
    expect(result.fightsUpdate).not.toHaveProperty("winner_id");
    expect(result.fightsUpdate).not.toHaveProperty("method");
    expect(result.fightsUpdate).not.toHaveProperty("round");
  });

  it("never writes the candidate's own external_id -- the kept row keeps its identity", () => {
    const result = buildDisputedOpponentResolution(conflict(), "candidate", NOW);
    expect(result.fightsUpdate).not.toHaveProperty("candidate_external_id");
    expect(result.fightsUpdate).not.toHaveProperty("external_id");
  });
});
