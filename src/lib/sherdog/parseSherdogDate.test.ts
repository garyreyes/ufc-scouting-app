import { describe, expect, it } from "vitest";
import { parseSherdogBirthDate, parseSherdogDate } from "./parseSherdogDate";

// L3-age: the bio's birth date is a DIFFERENT format from fight history
// ("Oct 17, 1989", day not zero-padded). Built from the text, never via
// Date parsing -- in UTC+8 a local-midnight Date shifts to the previous
// day on toISOString(), a silently wrong birth date.
describe("parseSherdogBirthDate", () => {
  it("parses Sherdog's bio format to an ISO date", () => {
    expect(parseSherdogBirthDate("Oct 17, 1989")).toBe("1989-10-17");
  });

  it("zero-pads a single-digit day (seen live: 'Dec 4, 2002')", () => {
    expect(parseSherdogBirthDate("Dec 4, 2002")).toBe("2002-12-04");
  });

  it("does not shift Jan 1 into the previous year (the timezone trap)", () => {
    expect(parseSherdogBirthDate("Jan 1, 2000")).toBe("2000-01-01");
  });

  it("applies the real leap-year rule", () => {
    expect(parseSherdogBirthDate("Feb 29, 2000")).toBe("2000-02-29");
    expect(parseSherdogBirthDate("Feb 29, 2001")).toBeNull();
    expect(parseSherdogBirthDate("Feb 30, 1990")).toBeNull();
  });

  it("returns null rather than guessing on anything else", () => {
    expect(parseSherdogBirthDate(null)).toBeNull();
    expect(parseSherdogBirthDate("N/A")).toBeNull();
    expect(parseSherdogBirthDate("1989-10-17")).toBeNull();
    expect(parseSherdogBirthDate("Mar / 07 / 2026")).toBeNull();
    expect(parseSherdogBirthDate("Octember 17, 1989")).toBeNull();
  });
});

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

  it("accepts Feb 29 in a leap year, rejects it otherwise (not a hard insert failure)", () => {
    expect(parseSherdogDate("Feb / 29 / 2020")).toBe("2020-02-29"); // leap
    expect(parseSherdogDate("Feb / 29 / 2019")).toBeNull(); // not leap
    expect(parseSherdogDate("Feb / 29 / 2100")).toBeNull(); // century, not leap
    expect(parseSherdogDate("Feb / 29 / 2000")).toBe("2000-02-29"); // 400
  });

  it("rejects Feb 30 always", () => {
    expect(parseSherdogDate("Feb / 30 / 2020")).toBeNull();
  });
});
