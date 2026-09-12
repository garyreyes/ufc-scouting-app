import { describe, expect, it } from "vitest";
import { ageOnDate } from "./ageOnDate";

// Whole years, birthday-aware, from ISO "YYYY-MM-DD" strings. Measured on
// the fight card's date, not "today", so a pick's inputs stay reproducible.
describe("ageOnDate", () => {
  it("counts whole years once the birthday has passed", () => {
    expect(ageOnDate("1991-10-27", "2026-11-01")).toBe(35);
  });

  it("is one year less the day before the birthday", () => {
    expect(ageOnDate("1991-10-27", "2026-10-26")).toBe(34);
  });

  it("counts the new year ON the birthday itself", () => {
    expect(ageOnDate("1991-10-27", "2026-10-27")).toBe(35);
  });

  it("treats a Feb 29 birthday as not yet reached on Feb 28 of a non-leap year", () => {
    expect(ageOnDate("2000-02-29", "2023-02-28")).toBe(22);
    expect(ageOnDate("2000-02-29", "2023-03-01")).toBe(23);
    expect(ageOnDate("2000-02-29", "2024-02-29")).toBe(24);
  });

  it("agrees with the age Sherdog printed on a real saved page (Makhachev, saved 2026-09-07)", () => {
    expect(ageOnDate("1991-10-27", "2026-09-07")).toBe(34);
  });
});
