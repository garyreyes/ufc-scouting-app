import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { birthDateFill } from "./birthDateFill";
import { parseBio } from "./parseFighterPage";

// L3-age: whether a Sherdog page's birth date gets written. Four outcomes,
// each asserted reachable. The printed-age cross-check is what catches a
// silently wrong date: Sherdog prints the fighter's age beside it, so a
// parse that lands on the wrong year disagrees with Sherdog's own number.

const SAVED_ON = "2026-09-07"; // when the fixtures were captured

describe("birthDateFill", () => {
  it("fills when the fighter has none and the date agrees with Sherdog's printed age", () => {
    expect(birthDateFill(null, { birthDate: "Oct 17, 1989", printedAge: 36 }, SAVED_ON)).toEqual({
      kind: "fill",
      birthDate: "1989-10-17",
    });
  });

  it("fills when Sherdog prints no age to cross-check against", () => {
    expect(birthDateFill(null, { birthDate: "Oct 17, 1989", printedAge: null }, SAVED_ON)).toEqual({
      kind: "fill",
      birthDate: "1989-10-17",
    });
  });

  it("never overwrites a birth date the fighter already has", () => {
    expect(birthDateFill("1989-10-18", { birthDate: "Oct 17, 1989", printedAge: 36 }, SAVED_ON)).toEqual({
      kind: "keep",
    });
  });

  it("reports missing when Sherdog shows no date", () => {
    expect(birthDateFill(null, { birthDate: null, printedAge: null }, SAVED_ON)).toEqual({ kind: "missing" });
  });

  it("reports missing when the date does not parse", () => {
    expect(birthDateFill(null, { birthDate: "Feb 30, 1990", printedAge: 36 }, SAVED_ON)).toEqual({
      kind: "missing",
    });
  });

  it("refuses to write when the computed age disagrees with Sherdog's printed age", () => {
    expect(birthDateFill(null, { birthDate: "Oct 17, 1989", printedAge: 35 }, SAVED_ON)).toEqual({
      kind: "mismatch",
      birthDate: "1989-10-17",
      computedAge: 36,
      printedAge: 35,
    });
  });

  it.each([
    ["fighter-oliveira-30300.html", "1989-10-17"],
    ["fighter-makhachev-76836.html", "1991-10-27"],
    ["fighter-figueiredo-110485.html", "1987-12-18"],
    ["fighter-qileng-aori-222519.html", "1993-06-25"],
  ])("cross-checks clean on the real saved page %s", (file, expected) => {
    const bio = parseBio(readFileSync(join(__dirname, "__fixtures__", file), "utf-8"));
    expect(birthDateFill(null, bio, SAVED_ON)).toEqual({ kind: "fill", birthDate: expected });
  });
});
