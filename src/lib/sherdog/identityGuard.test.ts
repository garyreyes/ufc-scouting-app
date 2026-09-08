import { describe, expect, it } from "vitest";
import { sherdogNameMatchesExpected } from "./identityGuard";

// The guard exists because a wrong sherdog_id fetches a DIFFERENT real
// fighter at HTTP 200 (spike, 2026-09-07). Both outcomes must be
// reachable and the real spike cases must land on the right side.

describe("sherdogNameMatchesExpected — accepts (write allowed)", () => {
  it("exact match", () => {
    expect(sherdogNameMatchesExpected("Islam Makhachev", "Islam Makhachev")).toBe(true);
  });

  it("case and whitespace differences", () => {
    expect(sherdogNameMatchesExpected("islam   makhachev", "Islam Makhachev")).toBe(true);
  });

  it("diacritic difference — the André/Andre Lima duplicate case", () => {
    expect(sherdogNameMatchesExpected("Andre Lima", "André Lima")).toBe(true);
  });

  it("word-order swap — Sherdog files 'Aori Qileng' as 'Qileng Aori'", () => {
    expect(sherdogNameMatchesExpected("Aori Qileng", "Qileng Aori")).toBe(true);
  });

  it("nickname baked into the page name", () => {
    expect(sherdogNameMatchesExpected("Charles Oliveira", "Charles do Bronx Oliveira")).toBe(true);
  });

  it("a dropped middle name", () => {
    expect(sherdogNameMatchesExpected("Marlon Vera Guaman", "Marlon Vera")).toBe(true);
  });

  it("minor spelling drift within the fuzzy floor", () => {
    expect(sherdogNameMatchesExpected("Aleksandar Rakic", "Aleksandr Rakic")).toBe(true);
  });
});

describe("sherdogNameMatchesExpected — rejects (write abandoned)", () => {
  it("the actual spike hazard: /fighter/x-99999 returned 'Larry Bo Johnson'", () => {
    expect(sherdogNameMatchesExpected("Islam Makhachev", "Larry Bo Johnson")).toBe(false);
  });

  it("shares only one common word", () => {
    expect(sherdogNameMatchesExpected("John Smith", "John Jones")).toBe(false);
  });

  it("shares a surname but not the person", () => {
    expect(sherdogNameMatchesExpected("Islam Makhachev", "Magomed Makhachev")).toBe(false);
  });

  it("empty expected name", () => {
    expect(sherdogNameMatchesExpected("", "Islam Makhachev")).toBe(false);
  });

  it("empty page name (parse failure upstream)", () => {
    expect(sherdogNameMatchesExpected("Islam Makhachev", "")).toBe(false);
  });
});
