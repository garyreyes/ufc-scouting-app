import { describe, expect, it } from "vitest";
import { formatRecord } from "./formatRecord";

describe("formatRecord", () => {
  it("omits draws when there are none", () => {
    expect(formatRecord({ wins: 12, losses: 3, draws: 0 })).toBe("12-3");
  });

  it("includes draws when there are any", () => {
    expect(formatRecord({ wins: 12, losses: 3, draws: 1 })).toBe("12-3-1");
  });

  it("does not render an all-zero total as a record", () => {
    // The important case: 0-0-0 is what recomputeFighterRecords stores
    // for a fighter with no countable outcome, and reading it as a
    // record would say something false about them.
    expect(formatRecord({ wins: 0, losses: 0, draws: 0 })).toBe("No tracked fights");
  });

  it("renders a genuine winless record rather than hiding it", () => {
    expect(formatRecord({ wins: 0, losses: 2, draws: 0 })).toBe("0-2");
  });

  it("renders a draws-only record", () => {
    expect(formatRecord({ wins: 0, losses: 0, draws: 1 })).toBe("0-0-1");
  });
});
