import { describe, expect, it } from "vitest";
import { sherdogSearchQueries } from "./sherdogSearchQueries";

describe("sherdogSearchQueries", () => {
  it("puts the original name first, so an exact hit is never passed over", () => {
    expect(sherdogSearchQueries("Islam Makhachev")[0]).toBe("Islam Makhachev");
  });

  it("adds a diacritic-folded variant (Sherdog search drops accented names)", () => {
    const qs = sherdogSearchQueries("Édgar Cháirez");
    expect(qs).toContain("Édgar Cháirez");
    expect(qs).toContain("Edgar Chairez");
  });

  it("adds a suffix-stripped variant (Sherdog search drops 'Jr.')", () => {
    const qs = sherdogSearchQueries("Michael Aswell Jr.");
    expect(qs).toContain("Michael Aswell Jr.");
    expect(qs).toContain("Michael Aswell");
  });

  it.each(["Jr", "Jr.", "Sr", "III", "IV"])("strips a trailing '%s'", (suffix) => {
    expect(sherdogSearchQueries(`Test Person ${suffix}`)).toContain("Test Person");
  });

  it("does not strip a name that merely contains those letters", () => {
    // "Ivan" ends in the letters of a numeral-ish token but is not a suffix
    expect(sherdogSearchQueries("Roman Ivanov")).toEqual(["Roman Ivanov"]);
  });

  it("de-duplicates when the variants collapse to the same string", () => {
    const qs = sherdogSearchQueries("Islam Makhachev");
    expect(qs).toEqual([...new Set(qs)]);
    expect(qs).toHaveLength(1);
  });

  it("collapses internal whitespace and trims", () => {
    expect(sherdogSearchQueries("  Jon   Jones  ")[0]).toBe("Jon Jones");
  });
});
