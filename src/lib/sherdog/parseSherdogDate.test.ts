import { describe, expect, it } from "vitest";
import { parseSherdogDate } from "./parseSherdogDate";

describe("parseSherdogDate", () => {
  it("parses Sherdog's 'Mon / DD / YYYY' format to an ISO date", () => {
    expect(parseSherdogDate("Mar / 07 / 2026")).toBe("2026-03-07");
  });

  it("handles a single-digit-looking day that Sherdog zero-pads", () => {
    expect(parseSherdogDate("Aug / 01 / 2010")).toBe("2010-08-01");
  });

  it("is tolerant of extra whitespace", () => {
    expect(parseSherdogDate("  Dec  /  25  /  1999 ")).toBe("1999-12-25");
  });

  it.each([
    ["Jan", "01"],
    ["Feb", "02"],
    ["Sep", "09"],
    ["Oct", "10"],
    ["Nov", "11"],
    ["Dec", "12"],
  ])("maps the month abbreviation %s to %s", (abbr, num) => {
    expect(parseSherdogDate(`${abbr} / 15 / 2020`)).toBe(`2020-${num}-15`);
  });

  it("returns null for null (a bout row with no date)", () => {
    expect(parseSherdogDate(null)).toBeNull();
  });

  it("returns null for a string it cannot parse rather than guessing", () => {
    expect(parseSherdogDate("N/A")).toBeNull();
    expect(parseSherdogDate("2026-03-07")).toBeNull();
    expect(parseSherdogDate("Marchtember / 07 / 2026")).toBeNull();
  });

  it("rejects an impossible day", () => {
    expect(parseSherdogDate("Feb / 40 / 2020")).toBeNull();
  });
});
