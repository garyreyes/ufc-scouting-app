import { describe, expect, it } from "vitest";
import { compareProposalAgreement } from "./compareProposalAgreement";

describe("compareProposalAgreement", () => {
  it("agrees when both proposals choose the same sherdog id", () => {
    expect(compareProposalAgreement(555, 555)).toBe("agree");
  });

  it("agrees when both proposals choose null (neither confident in any candidate)", () => {
    expect(compareProposalAgreement(null, null)).toBe("agree");
  });

  it("disagrees when the two proposals choose different sherdog ids", () => {
    expect(compareProposalAgreement(555, 200)).toBe("disagree");
  });

  it("disagrees when the primary chose a candidate but the second opinion chose null", () => {
    expect(compareProposalAgreement(555, null)).toBe("disagree");
  });

  it("disagrees when the primary chose null but the second opinion chose a candidate", () => {
    expect(compareProposalAgreement(null, 555)).toBe("disagree");
  });
});
