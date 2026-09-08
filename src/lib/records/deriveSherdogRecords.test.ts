import { describe, expect, it } from "vitest";
import { deriveSherdogRecords } from "./deriveSherdogRecords";
import type { SherdogBoutForRecord } from "./deriveSherdogRecords";

const A = "aaaaaaaa-0000-0000-0000-000000000000";
const B = "bbbbbbbb-0000-0000-0000-000000000000";

const b = (fighterId: string, result: SherdogBoutForRecord["result"]): SherdogBoutForRecord => ({
  fighterId,
  result,
});

describe("deriveSherdogRecords", () => {
  it("counts wins, losses and draws per fighter", () => {
    const m = deriveSherdogRecords([
      b(A, "win"),
      b(A, "win"),
      b(A, "loss"),
      b(A, "draw"),
      b(B, "loss"),
    ]);
    expect(m.get(A)).toEqual({ wins: 2, losses: 1, draws: 1 });
    expect(m.get(B)).toEqual({ wins: 0, losses: 1, draws: 0 });
  });

  it("does not count a No Contest or an unparsed result", () => {
    const m = deriveSherdogRecords([b(A, "win"), b(A, "nc"), b(A, "unknown")]);
    expect(m.get(A)).toEqual({ wins: 1, losses: 0, draws: 0 });
  });

  it("omits a fighter with no countable bout rather than returning 0-0-0", () => {
    // Same convention as deriveFighterRecords -- 'absent' vs 'counted zero'.
    const m = deriveSherdogRecords([b(A, "nc")]);
    expect(m.has(A)).toBe(false);
  });

  it("returns an empty map for no bouts", () => {
    expect(deriveSherdogRecords([]).size).toBe(0);
  });

  it("every result value is reachable in the count", () => {
    const m = deriveSherdogRecords([b(A, "win"), b(A, "loss"), b(A, "draw"), b(B, "nc"), b(B, "unknown")]);
    expect(m.get(A)).toEqual({ wins: 1, losses: 1, draws: 1 });
    expect(m.has(B)).toBe(false);
  });
});
