import { describe, expect, it } from "vitest";
import { buildSherdogMatchResolution } from "./resolveSherdogMatch";
import type { LowConfidenceSherdogMatchConflict } from "./types";

function conflict(): LowConfidenceSherdogMatchConflict {
  return {
    id: "conflict-1",
    kind: "low_confidence_sherdog_match",
    fightId: null,
    detectedAt: "2026-09-07T00:00:00Z",
    details: {
      fighterId: "fighter-1",
      storedName: "Aori Qileng",
      reason: "below_threshold",
      candidates: [
        {
          sherdogId: 222519,
          name: "Qileng Aori",
          confidence: 0.8,
          nickname: "Mongolian Murderer",
          heightImperial: `5'7"`,
          weightImperial: "135 lbs",
          association: "Team Alpha Male",
        },
        {
          sherdogId: 999999,
          name: "Aori Something",
          confidence: 0.4,
          nickname: null,
          heightImperial: null,
          weightImperial: null,
          association: null,
        },
      ],
    },
  };
}

describe("buildSherdogMatchResolution", () => {
  it("writes the chosen candidate's Sherdog id, and only that (plus the checked marker)", () => {
    const r = buildSherdogMatchResolution(conflict(), 222519, new Date("2026-09-07T12:00:00Z"));
    expect(r.fightersUpdate).toEqual({
      sherdog_id: 222519,
      sherdog_checked_at: "2026-09-07T12:00:00.000Z",
    });
  });

  it("can pick a lower-ranked candidate, not just the top one", () => {
    const r = buildSherdogMatchResolution(conflict(), 999999, new Date("2026-09-07T12:00:00Z"));
    expect(r.fightersUpdate?.sherdog_id).toBe(999999);
  });

  it("names the chosen id in the resolution string", () => {
    const r = buildSherdogMatchResolution(conflict(), 222519, new Date("2026-09-07T12:00:00Z"));
    expect(r.conflictUpdate.resolved_at).toBe("2026-09-07T12:00:00.000Z");
    expect(r.conflictUpdate.resolution).toBe("matched_to_sherdog_id:222519");
  });

  it("writes nothing onto the fighter when the owner rejects every candidate", () => {
    const r = buildSherdogMatchResolution(conflict(), null, new Date("2026-09-07T12:00:00Z"));
    expect(r.fightersUpdate).toBeNull();
    expect(r.conflictUpdate.resolution).toBe("no_match");
  });

  it("refuses a Sherdog id that isn't one of this conflict's own snapshotted candidates", () => {
    expect(() => buildSherdogMatchResolution(conflict(), 12345)).toThrow(/not among this conflict/);
  });
});
