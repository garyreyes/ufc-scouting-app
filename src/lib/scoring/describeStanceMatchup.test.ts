import { describe, expect, it } from "vitest";
import { describeStanceMatchup } from "./describeStanceMatchup";

// The scoreboard's stance/style breakdown (docs/PRD.md UC-4) buckets
// picks by this label -- getting the canonicalization wrong would split
// one real matchup into two different buckets ("Orthodox vs Southpaw"
// and "Southpaw vs Orthodox") depending on which fighter happened to be
// fighter1, silently fragmenting the very breakdown the filter exists to
// show accurately.
describe("describeStanceMatchup", () => {
  it("orders two different stances alphabetically, regardless of input order", () => {
    expect(describeStanceMatchup("Southpaw", "Orthodox")).toBe("Orthodox vs Southpaw");
    expect(describeStanceMatchup("Orthodox", "Southpaw")).toBe("Orthodox vs Southpaw");
  });

  it("shows a same-stance matchup as itself twice", () => {
    expect(describeStanceMatchup("Orthodox", "Orthodox")).toBe("Orthodox vs Orthodox");
  });

  it("returns Unknown when either stance is missing", () => {
    expect(describeStanceMatchup(null, "Orthodox")).toBe("Unknown");
    expect(describeStanceMatchup("Orthodox", null)).toBe("Unknown");
    expect(describeStanceMatchup(null, null)).toBe("Unknown");
  });

  it("handles a three-way stance (Switch) the same as any other", () => {
    expect(describeStanceMatchup("Switch", "Orthodox")).toBe("Orthodox vs Switch");
  });
});
