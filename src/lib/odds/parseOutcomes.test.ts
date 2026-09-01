import { describe, expect, it } from "vitest";
import { parseFighterPrices } from "./parseOutcomes";
import type { OddsEvent } from "./types";

// Real payload shape, trimmed from a live response captured 2026-09-01
// (see CHANGES.md Phase 16) -- Manon Fiorot vs Alexa Grasso, UFC 331.
function realEvent(overrides: Partial<OddsEvent> = {}): OddsEvent {
  return {
    id: "1c075185d91e84c1317a9f6bdad39e6b",
    commence_time: "2026-09-13T00:00:00Z",
    home_team: "Manon Fiorot",
    away_team: "Alexa Grasso",
    bookmakers: [
      {
        key: "onexbet",
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
  it("extracts both fighters' prices and discards Draw", () => {
    const result = parseFighterPrices(realEvent(), "Manon Fiorot", "Alexa Grasso");
    expect(result).toEqual({ fighter1Price: 1.46, fighter2Price: 2.83 });
  });

  it("maps correctly regardless of outcome array order", () => {
    // Same event, outcomes shuffled -- the function must match by name
    // similarity, not by array position.
    const shuffled = realEvent({
      bookmakers: [
        {
          key: "onexbet",
          markets: [
            {
              key: "h2h",
              outcomes: [
                { name: "Draw", price: 33.0 },
                { name: "Manon Fiorot", price: 1.46 },
                { name: "Alexa Grasso", price: 2.83 },
              ],
            },
          ],
        },
      ],
    });
    const result = parseFighterPrices(shuffled, "Manon Fiorot", "Alexa Grasso");
    expect(result).toEqual({ fighter1Price: 1.46, fighter2Price: 2.83 });
  });

  it("maps correctly when fighter1/fighter2 are swapped relative to the event", () => {
    const result = parseFighterPrices(realEvent(), "Alexa Grasso", "Manon Fiorot");
    expect(result).toEqual({ fighter1Price: 2.83, fighter2Price: 1.46 });
  });

  it("returns null when there is no onexbet bookmaker", () => {
    const event = realEvent({ bookmakers: [] });
    expect(parseFighterPrices(event, "Manon Fiorot", "Alexa Grasso")).toBeNull();
  });

  it("returns null when there is no h2h market", () => {
    const event = realEvent({
      bookmakers: [{ key: "onexbet", markets: [{ key: "totals", outcomes: [] }] }],
    });
    expect(parseFighterPrices(event, "Manon Fiorot", "Alexa Grasso")).toBeNull();
  });

  it("returns null rather than guess when both names match the same outcome", () => {
    // Ambiguous on purpose: two near-identical names against one outcome.
    const event = realEvent({
      bookmakers: [
        {
          key: "onexbet",
          markets: [
            {
              key: "h2h",
              outcomes: [
                { name: "John Smith", price: 1.9 },
                { name: "Draw", price: 33.0 },
              ],
            },
          ],
        },
      ],
    });
    expect(parseFighterPrices(event, "John Smith", "Jon Smyth")).toBeNull();
  });

  // Realistic fighter names never actually name-match "Draw" well enough
  // to be chosen -- so a test using real names (e.g. Manon Fiorot / Alexa
  // Grasso) passes even if the explicit discard is deleted, and proves
  // nothing about it. This constructs a synthetic, deliberately
  // adversarial name -- a "fighter" literally named "Draw" -- so the
  // filter is the only thing standing between this input and a false
  // match. Confirmed by mutation: deleting the Draw filter makes this
  // test fail (fighter2Price becomes 33.0) while every other test in this
  // file still passes.
  it("discards the Draw outcome even when adversarially asked to match it", () => {
    const event: OddsEvent = {
      id: "synthetic",
      commence_time: "2026-09-13T00:00:00Z",
      home_team: "Real Fighter",
      away_team: "Draw",
      bookmakers: [
        {
          key: "onexbet",
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
