import { describe, expect, it } from "vitest";
import { sharesExactlyOneFighter } from "./sharesExactlyOneFighter";

// ARCHITECTURE.md Fork 5's core detection rule: a candidate sharing
// exactly one fighter with an incoming fight is a disputed opponent, not
// a new bout and not the same bout. Zero shared fighters means genuinely
// unrelated fights; two shared fighters means the same fight (already
// caught by the exact unordered-pair match upstream in upsertFight.ts,
// which runs before this check). A miss here inserts a duplicate row for
// what CHANGES.md Phase 7 found was really one disputed bout.
describe("sharesExactlyOneFighter", () => {
  // The real Phase 7 case: Louie Sutherland's opponent was reported
  // differently by each source. Same fighter1, different fighter2.
  it("is true for the real Phase 7 disputed-opponent case", () => {
    const candidate = { fighter1_id: "sutherland", fighter2_id: "silva-lopes" };
    const incoming = { fighter1_id: "sutherland", fighter2_id: "jose-luiz" };
    expect(sharesExactlyOneFighter(candidate, incoming)).toBe(true);
  });

  it("is true regardless of which position the shared fighter is in", () => {
    const candidate = { fighter1_id: "a", fighter2_id: "b" };
    const incoming = { fighter1_id: "c", fighter2_id: "b" };
    expect(sharesExactlyOneFighter(candidate, incoming)).toBe(true);
  });

  it("is false for two completely unrelated fights (zero shared)", () => {
    const candidate = { fighter1_id: "a", fighter2_id: "b" };
    const incoming = { fighter1_id: "c", fighter2_id: "d" };
    expect(sharesExactlyOneFighter(candidate, incoming)).toBe(false);
  });

  it("is false for the same fight in the same order (two shared) -- not a dispute", () => {
    const candidate = { fighter1_id: "a", fighter2_id: "b" };
    const incoming = { fighter1_id: "a", fighter2_id: "b" };
    expect(sharesExactlyOneFighter(candidate, incoming)).toBe(false);
  });

  it("is false for the same fight with fighters swapped (two shared) -- already caught upstream", () => {
    const candidate = { fighter1_id: "a", fighter2_id: "b" };
    const incoming = { fighter1_id: "b", fighter2_id: "a" };
    expect(sharesExactlyOneFighter(candidate, incoming)).toBe(false);
  });
});
