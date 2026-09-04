import { describe, expect, it } from "vitest";
import { isUfcMmaEventTitle } from "./fetchSchedule";

// The `Category:<year> in UFC` pages mix real cards in with grappling
// events and navigation pages (verified live building I4). fetchEventSchedule
// would return 0 bouts for the non-cards and they'd be skipped anyway, but
// filtering them out up front keeps a wasted Wikipedia fetch (and the
// rate limit it counts against) off every run.

describe("isUfcMmaEventTitle", () => {
  it("accepts numbered, Fight Night, and network-branded cards", () => {
    for (const t of [
      "UFC 311",
      "UFC Fight Night: Adesanya vs. Imavov",
      "UFC on ESPN: Taira vs. Park",
      "UFC on ABC: Whittaker vs. de Ridder",
      "UFC Fight Night 292",
    ]) {
      expect(isUfcMmaEventTitle(t)).toBe(true);
    }
  });

  it("rejects UFC BJJ grappling cards", () => {
    expect(isUfcMmaEventTitle("UFC BJJ 3")).toBe(false);
    expect(isUfcMmaEventTitle("UFC BJJ 10")).toBe(false);
  });

  it("rejects list / navigation pages", () => {
    expect(isUfcMmaEventTitle("List of UFC events")).toBe(false);
  });

  it("rejects anything not starting with UFC", () => {
    expect(isUfcMmaEventTitle("2025 in UFC")).toBe(false);
    expect(isUfcMmaEventTitle("Dana White")).toBe(false);
  });
});
