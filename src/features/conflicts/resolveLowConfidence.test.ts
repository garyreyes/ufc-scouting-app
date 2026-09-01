import { describe, expect, it } from "vitest";
import { buildLowConfidenceResolution } from "./resolveLowConfidence";
import type { LowConfidenceConflict } from "./types";
import type { OddsEvent } from "@/lib/odds/types";

const NOW = new Date("2026-09-05T00:00:00Z");

function oddsEvent(overrides: Partial<OddsEvent> = {}): OddsEvent {
  return {
    id: "odds-event-1",
    commence_time: "2026-09-20T04:00:00Z",
    home_team: "Alexandre Pantoja",
    away_team: "Joshua Van",
    bookmakers: [
      {
        key: "betonlineag",
        markets: [
          {
            key: "h2h",
            outcomes: [
              { name: "Alexandre Pantoja", price: 1.5 },
              { name: "Joshua Van", price: 2.6 },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function conflict(overrides: Partial<OddsEvent> = {}): LowConfidenceConflict {
  return {
    id: "conflict-1",
    kind: "low_confidence_odds_match",
    fightId: null,
    detectedAt: "2026-09-01T00:00:00Z",
    details: {
      oddsEvent: oddsEvent(overrides),
      confidence: 0.6,
      candidateFightId: "algorithm-guess-fight",
    },
  };
}

describe("buildLowConfidenceResolution", () => {
  it("resolves using the OWNER-CHOSEN fight, not the algorithm's own guess", () => {
    // The whole point of B6's picker: the owner can override a wrong
    // algorithm guess. If this used details.candidateFightId instead of
    // the chosenFightId argument, that override would be impossible.
    const result = buildLowConfidenceResolution(
      conflict(),
      "owner-chosen-fight",
      "Joshua Van",
      "Alexandre Pantoja",
      NOW,
    );
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.snapshotInsert.fight_id).toBe("owner-chosen-fight");
    }
  });

  it("writes the correct fighter prices from the odds payload", () => {
    const result = buildLowConfidenceResolution(
      conflict(),
      "owner-chosen-fight",
      "Joshua Van",
      "Alexandre Pantoja",
      NOW,
    );
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.snapshotInsert.fighter1_price).toBe(2.6); // Joshua Van
      expect(result.snapshotInsert.fighter2_price).toBe(1.5); // Alexandre Pantoja
    }
  });

  it("resolves the conflict row referencing the chosen fight", () => {
    const result = buildLowConfidenceResolution(
      conflict(),
      "owner-chosen-fight",
      "Joshua Van",
      "Alexandre Pantoja",
      NOW,
    );
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.conflictUpdate.resolved_at).toBe("2026-09-05T00:00:00.000Z");
      expect(result.conflictUpdate.resolution).toContain("owner-chosen-fight");
    }
  });

  it("refuses to guess when the chosen fighters don't actually appear in the odds payload", () => {
    // Defensive: shouldn't happen for a genuine rankFightMatches candidate,
    // but the resolution must never silently write a price for the wrong
    // fighters rather than fail loudly.
    const result = buildLowConfidenceResolution(
      conflict(),
      "owner-chosen-fight",
      "Someone Completely Unrelated",
      "Another Unrelated Person",
      NOW,
    );
    expect(result.kind).toBe("no_price");
  });
});
