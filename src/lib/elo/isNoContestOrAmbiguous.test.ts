import { describe, expect, it } from "vitest";
import { isNoContestOrAmbiguous } from "./isNoContestOrAmbiguous";

describe("isNoContestOrAmbiguous", () => {
  it("treats a null method as ambiguous", () => {
    // The api_sports_only_24h settlement path writes winner-with-no-method.
    // With a null winner too, nothing distinguishes a draw from an NC.
    expect(isNoContestOrAmbiguous(null)).toBe(true);
  });

  it("recognises the bare NC abbreviation", () => {
    expect(isNoContestOrAmbiguous("NC")).toBe(true);
    expect(isNoContestOrAmbiguous("NC (overturned)")).toBe(true);
  });

  it("recognises the spelled-out form, case-insensitively", () => {
    expect(isNoContestOrAmbiguous("No Contest")).toBe(true);
    expect(isNoContestOrAmbiguous("no contest (accidental foul)")).toBe(true);
  });

  it("does not fire on NC appearing inside a longer word", () => {
    // The \b guard is why this matters -- "Technical" and "Decision" both
    // contain the letters, and a substring match would silently discard
    // every decision in the database as a No Contest.
    expect(isNoContestOrAmbiguous("Decision (unanimous)")).toBe(false);
    expect(isNoContestOrAmbiguous("Technical Submission")).toBe(false);
  });

  it("passes real finishes and real draws through", () => {
    expect(isNoContestOrAmbiguous("KO (punches)")).toBe(false);
    expect(isNoContestOrAmbiguous("Submission (rear-naked choke)")).toBe(false);
    expect(isNoContestOrAmbiguous("Draw (split)")).toBe(false);
    expect(isNoContestOrAmbiguous("Draw (majority)")).toBe(false);
  });
});
