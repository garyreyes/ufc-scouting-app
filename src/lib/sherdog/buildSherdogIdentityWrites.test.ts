import { describe, expect, it } from "vitest";
import type { SherdogSearchCandidate } from "./parseSearch";
import { rankSherdogCandidates } from "./resolveSherdogIdentity";
import { buildSherdogConflictInsert, buildSherdogIdentityUpdate } from "./buildSherdogIdentityWrites";

describe("buildSherdogIdentityUpdate", () => {
  it("writes exactly sherdog_id and sherdog_checked_at, nothing else", () => {
    const u = buildSherdogIdentityUpdate(76836, "2026-09-07T00:00:00.000Z");
    expect(u).toEqual({ sherdog_id: 76836, sherdog_checked_at: "2026-09-07T00:00:00.000Z" });
    expect(Object.keys(u).sort()).toEqual(["sherdog_checked_at", "sherdog_id"]);
  });
});

describe("buildSherdogConflictInsert", () => {
  const candidates: SherdogSearchCandidate[] = [
    {
      sherdogId: 2456,
      name: "Alexandre Lima",
      nickname: "Bam Bam",
      heightImperial: `5'11"`,
      weightImperial: "185 lbs",
      association: "Team Carvalho",
    },
    {
      sherdogId: 201199,
      name: "Andre Lima",
      nickname: "Mascote",
      heightImperial: `5'7"`,
      weightImperial: "127 lbs",
      association: "Mascote Team",
    },
  ];

  it("is a low_confidence_sherdog_match row with fight_id null", () => {
    const row = buildSherdogConflictInsert(
      "fighter-uuid",
      "Andre Lima",
      rankSherdogCandidates("Andre Lima", candidates),
      candidates,
      "below_threshold",
    );
    expect(row.kind).toBe("low_confidence_sherdog_match");
    expect(row.fight_id).toBeNull();
    expect(row.details.fighterId).toBe("fighter-uuid");
    expect(row.details.storedName).toBe("Andre Lima");
    expect(row.details.reason).toBe("below_threshold");
  });

  it("carries the guard-mismatch page name only when that is the reason", () => {
    const ranked = rankSherdogCandidates("Andre Lima", candidates);
    const withName = buildSherdogConflictInsert("f", "Andre Lima", ranked, candidates, "guard_mismatch", "Someone Else");
    expect(withName.details.reason).toBe("guard_mismatch");
    expect(withName.details.guardMismatchPageName).toBe("Someone Else");

    const without = buildSherdogConflictInsert("f", "Andre Lima", ranked, candidates, "ambiguous");
    expect(without.details).not.toHaveProperty("guardMismatchPageName");
  });

  it("snapshots every candidate, best-first, with score + distinguishing details merged in", () => {
    const ranked = rankSherdogCandidates("Andre Lima", candidates);
    const row = buildSherdogConflictInsert("f", "Andre Lima", ranked, candidates, "below_threshold");

    // "Andre Lima" is a closer match to "Andre Lima" than "Alexandre Lima".
    expect(row.details.candidates[0].sherdogId).toBe(201199);
    expect(row.details.candidates[0]).toMatchObject({
      name: "Andre Lima",
      nickname: "Mascote",
      heightImperial: `5'7"`,
      weightImperial: "127 lbs",
      association: "Mascote Team",
    });
    expect(row.details.candidates[0].confidence).toBeGreaterThan(row.details.candidates[1].confidence);
    expect(row.details.candidates).toHaveLength(2);
  });

  it("tolerates a ranked entry with no matching candidate object (defensive nulls)", () => {
    const row = buildSherdogConflictInsert(
      "f",
      "X",
      [{ sherdogId: 55555, name: "Ghost", confidence: 0.2 }],
      [],
      "below_threshold",
    );
    expect(row.details.candidates[0]).toEqual({
      sherdogId: 55555,
      name: "Ghost",
      confidence: 0.2,
      nickname: null,
      heightImperial: null,
      weightImperial: null,
      association: null,
    });
  });
});
