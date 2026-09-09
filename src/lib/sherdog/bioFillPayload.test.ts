import { describe, expect, it } from "vitest";
import { bioFillPayload } from "./bioFillPayload";

describe("bioFillPayload", () => {
  it("fills both when the fighter has neither", () => {
    expect(bioFillPayload({ height_cm: null, weight_kg: null }, { heightCm: 178, weightKg: 70 })).toEqual({
      height_cm: 178,
      weight_kg: 70,
    });
  });

  it("never overwrites a value that is already set", () => {
    expect(bioFillPayload({ height_cm: 180, weight_kg: 84 }, { heightCm: 178, weightKg: 70 })).toEqual({});
  });

  it("fills only the missing side", () => {
    expect(bioFillPayload({ height_cm: 180, weight_kg: null }, { heightCm: 178, weightKg: 70 })).toEqual({
      weight_kg: 70,
    });
  });

  it("returns nothing when the fighter has a gap Sherdog also can't fill", () => {
    expect(bioFillPayload({ height_cm: null, weight_kg: null }, { heightCm: null, weightKg: null })).toEqual({});
  });
});
