import { describe, expect, it } from "vitest";
import { checkLegOverride, type LegOverrideContext } from "./checkLegOverride";

const NOW = new Date("2026-10-03T10:00:00Z");

function ctx(o: Partial<LegOverrideContext> = {}): LegOverrideContext {
  return {
    slipAuthor: "INTERN",
    slipStatus: "open",
    priceSource: "estimated",
    legResult: "pending",
    // Card starts 2026-10-03T22:00Z -> Intern lock at 16:00Z, six hours after NOW.
    startsAt: "2026-10-03T22:00:00Z",
    price: 2.25,
    now: NOW,
    ...o,
  };
}

describe("checkLegOverride", () => {
  it("allows the owner to type a real book price over an estimated leg before the lock", () => {
    expect(checkLegOverride(ctx())).toBeNull();
  });

  it("allows re-entering a price already entered", () => {
    expect(checkLegOverride(ctx({ priceSource: "entered" }))).toBeNull();
  });

  it("refuses a leg priced from the real ingested line -- only estimates are the owner's to correct", () => {
    expect(checkLegOverride(ctx({ priceSource: "book" }))).toMatch(/estimated/i);
  });

  it("refuses the owner's own slips (they already have their own journal)", () => {
    expect(checkLegOverride(ctx({ slipAuthor: "USER" }))).toMatch(/intern/i);
  });

  it("refuses once the slip or leg has settled", () => {
    expect(checkLegOverride(ctx({ slipStatus: "won" }))).toMatch(/settled|open/i);
    expect(checkLegOverride(ctx({ legResult: "lost" }))).toMatch(/settled|open/i);
  });

  it("refuses at and after the Intern's T-6h lock -- a price entered after the fact is hindsight", () => {
    expect(checkLegOverride(ctx({ now: new Date("2026-10-03T16:00:00Z") }))).toMatch(/lock/i);
  });

  it("refuses a price that isn't a real decimal price", () => {
    expect(checkLegOverride(ctx({ price: 1 }))).toMatch(/price/i);
    expect(checkLegOverride(ctx({ price: Number.NaN }))).toMatch(/price/i);
    expect(checkLegOverride(ctx({ price: 1001 }))).toMatch(/price/i);
  });
});
