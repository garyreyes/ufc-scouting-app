import { describe, expect, it } from "vitest";
import { identifyDifferingFighters } from "./identifyDifferingFighters";

describe("identifyDifferingFighters", () => {
  it("returns the two non-shared ids when fighter1 is the shared slot", () => {
    const existing = { fighter1_id: "silva", fighter2_id: "delgado-old" };
    const candidate = { fighter1_id: "silva", fighter2_id: "delgado-new" };
    expect(identifyDifferingFighters(existing, candidate)).toEqual({ a: "delgado-old", b: "delgado-new" });
  });

  it("returns the two non-shared ids when the shared fighter is in different slots", () => {
    const existing = { fighter1_id: "delgado-old", fighter2_id: "silva" };
    const candidate = { fighter1_id: "silva", fighter2_id: "delgado-new" };
    expect(identifyDifferingFighters(existing, candidate)).toEqual({ a: "delgado-old", b: "delgado-new" });
  });

  it("returns null when the pairs share zero fighters", () => {
    const existing = { fighter1_id: "a", fighter2_id: "b" };
    const candidate = { fighter1_id: "c", fighter2_id: "d" };
    expect(identifyDifferingFighters(existing, candidate)).toBeNull();
  });

  it("returns null when the pairs are identical (share both)", () => {
    const existing = { fighter1_id: "a", fighter2_id: "b" };
    const candidate = { fighter1_id: "b", fighter2_id: "a" };
    expect(identifyDifferingFighters(existing, candidate)).toBeNull();
  });
});
