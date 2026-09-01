import { describe, expect, it } from "vitest";
import { parseFighterPrices } from "./parseOutcomes";
import type { OddsEvent } from "./types";

// Real payload shape, captured live 2026-09-01 (CHANGES.md Phase 20) --
// BetOnline.ag, UFC 331 main event, Joshua Van vs Alexandre Pantoja.
// Clean 2-way, no Draw entry.
function realEvent(overrides: Partial<OddsEvent> = {}): OddsEvent {
  return {
    id: "097259d4c82c4ae646995fc8d665c410",
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
              { name: "Alexandre Pantoja", price: 1.88 },
              { name: "Joshua Van", price: 1.93 },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

// The three-outcome shape the app's original bookmaker (1xBet) returned,
// captured live 2026-08-01 (Phase 16). BetOnline.ag doesn't produce this,
// but the parser must still handle it correctly -- a future bookmaker
// change could reintroduce a Draw entry, and this is a real input shape
// the function is specified to discard, not one invented for the test.
function threeOutcomeEvent(overrides: Partial<OddsEvent> = {}): OddsEvent {
  return {
    id: "1c075185d91e84c1317a9f6bdad39e6b",
    commence_time: "2026-09-13T00:00:00Z",
    home_team: "Manon Fiorot",
    away_team: "Alexa Grasso",
    bookmakers: [
      {
        key: "betonlineag",
        markets: [
          {
            key: "h2h",
            outcomes: [
              { name: "Alexa Grasso", price: 2.83 },
              { name: "Manon Fiorot", price: 1.46 },
              { name: "Draw", price: 33.0 },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("parseFighterPrices", () => {
  it("extracts both fighters' prices from a clean 2-way market", () => {
    const result = parseFighterPrices(realEvent(), "Alexandre Pantoja", "Joshua Van");
    expect(result).toEqual({ fighter1Price: 1.88, fighter2Price: 1.93 });
  });

  it("maps correctly regardless of outcome array order", () => {
    const shuffled = realEvent({
      bookmakers: [
        {
          key: "betonlineag",
          markets: [
            {
              key: "h2h",
              outcomes: [
                { name: "Joshua Van", price: 1.93 },
                { name: "Alexandre Pantoja", price: 1.88 },
              ],
            },
          ],
        },
      ],
    });
    const result = parseFighterPrices(shuffled, "Alexandre Pantoja", "Joshua Van");
    expect(result).toEqual({ fighter1Price: 1.88, fighter2Price: 1.93 });
  });

  it("maps correctly when fighter1/fighter2 are swapped relative to the event", () => {
    const result = parseFighterPrices(realEvent(), "Joshua Van", "Alexandre Pantoja");
    expect(result).toEqual({ fighter1Price: 1.93, fighter2Price: 1.88 });
  });

  it("still discards a Draw outcome if one is present (three-outcome market)", () => {
    const result = parseFighterPrices(threeOutcomeEvent(), "Manon Fiorot", "Alexa Grasso");
    expect(result).toEqual({ fighter1Price: 1.46, fighter2Price: 2.83 });
  });

  it("returns null when there is no market from the configured bookmaker", () => {
    const event = realEvent({ bookmakers: [] });
    expect(parseFighterPrices(event, "Alexandre Pantoja", "Joshua Van")).toBeNull();
  });

  it("returns null when there is no h2h market", () => {
    const event = realEvent({
      bookmakers: [{ key: "betonlineag", markets: [{ key: "totals", outcomes: [] }] }],
    });
    expect(parseFighterPrices(event, "Alexandre Pantoja", "Joshua Van")).toBeNull();
  });

  it("returns null rather than guess when both names match the same outcome", () => {
    // Ambiguous on purpose: two near-identical names against one outcome.
    const event = realEvent({
      bookmakers: [
        {
          key: "betonlineag",
          markets: [{ key: "h2h", outcomes: [{ name: "John Smith", price: 1.9 }] }],
        },
      ],
    });
    expect(parseFighterPrices(event, "John Smith", "Jon Smyth")).toBeNull();
  });

  // Realistic fighter names never actually name-match "Draw" well enough
  // to be chosen -- so a test using real names (e.g. the fixtures above)
  // passes even if the explicit discard is deleted, and proves nothing
  // about it. This constructs a synthetic, deliberately adversarial name
  // -- a "fighter" literally named "Draw" -- so the filter is the only
  // thing standing between this input and a false match. Confirmed by
  // mutation when first written (CHANGES.md Phase 18): deleting the Draw
  // filter made this test fail (fighter2Price became 33.0) while every
  // other test in this file still passed.
  it("discards the Draw outcome even when adversarially asked to match it", () => {
    const event: OddsEvent = {
      id: "synthetic",
      commence_time: "2026-09-13T00:00:00Z",
      home_team: "Real Fighter",
      away_team: "Draw",
      bookmakers: [
        {
          key: "betonlineag",
          markets: [
            {
              key: "h2h",
              outcomes: [
                { name: "Real Fighter", price: 1.9 },
                { name: "Draw", price: 33.0 },
              ],
            },
          ],
        },
      ],
    };
    const result = parseFighterPrices(event, "Real Fighter", "Draw");
    expect(result).toBeNull();
  });
});
