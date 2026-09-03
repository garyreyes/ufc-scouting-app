import { describe, expect, it } from "vitest";
import { sanitizeSearchQuery } from "./sanitizeSearchQuery";

describe("sanitizeSearchQuery", () => {
  it("leaves an already-clean name unchanged", () => {
    expect(sanitizeSearchQuery("Dan Hooker")).toBe("Dan Hooker");
  });

  // Every one of these is a REAL production failure (2026-09-03): I2's
  // first live batch sent these names straight to API-Sports' search
  // endpoint and got "{\"search\":\"The Search field may only contain
  // alpha-numeric characters and spaces.\"}" back for all nine -- a real,
  // previously-undocumented limit, found by triggering it live rather
  // than assumed from docs (CLAUDE.md's standing rule).
  it.each([
    ["Maurício Ruffy", "Mauricio Ruffy"],
    ["Patrício Pitbull", "Patricio Pitbull"],
    ["Choi Doo-ho", "Choi Doo ho"],
    ["Michael Aswell Jr.", "Michael Aswell Jr"],
    ["José Luiz", "Jose Luiz"],
    ["Gianni Vázquez", "Gianni Vazquez"],
    ["Casey O'Neill", "Casey O Neill"],
    ["Yoo Joo-sang", "Yoo Joo sang"],
    ["Joel Álvarez", "Joel Alvarez"],
  ])("sanitizes %s into a query the API will actually accept", (input, expected) => {
    expect(sanitizeSearchQuery(input)).toBe(expected);
  });

  it("never returns a string containing anything but letters, digits and single spaces", () => {
    const result = sanitizeSearchQuery("Choi Doo-ho Jr. (né O'Neill-Álvarez)");
    expect(result).toMatch(/^[A-Za-z0-9 ]*$/);
  });

  it("collapses runs of stripped characters into a single space, never a run of spaces", () => {
    expect(sanitizeSearchQuery("Doo---ho")).not.toMatch(/ {2,}/);
  });

  it("trims leading and trailing whitespace left behind by a stripped character at either end", () => {
    expect(sanitizeSearchQuery("O'Neill")).not.toMatch(/^\s|\s$/);
  });
});
