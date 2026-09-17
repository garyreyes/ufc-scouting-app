import { describe, expect, it } from "vitest";
import { pickCanonicalFighter } from "./pickCanonicalFighter";

describe("pickCanonicalFighter", () => {
  it("returns the only row when there is no collision", () => {
    const row = { id: "a", external_id: null };
    expect(pickCanonicalFighter([row])).toBe(row);
  });

  it("prefers the row carrying an external_id", () => {
    const withId = { id: "b", external_id: "1234" };
    const withoutId = { id: "a", external_id: null };
    expect(pickCanonicalFighter([withoutId, withId])).toBe(withId);
  });

  it("breaks a tie between two external_id rows on the lowest id", () => {
    const first = { id: "a", external_id: "1" };
    const second = { id: "b", external_id: "2" };
    expect(pickCanonicalFighter([second, first])).toBe(first);
  });

  it("breaks a tie between two rows with no external_id on the lowest id", () => {
    const first = { id: "a", external_id: null };
    const second = { id: "b", external_id: null };
    expect(pickCanonicalFighter([second, first])).toBe(first);
  });

  it("throws on an empty list rather than returning undefined", () => {
    expect(() => pickCanonicalFighter([])).toThrow();
  });
});
