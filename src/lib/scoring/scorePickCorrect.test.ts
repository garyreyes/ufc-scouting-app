import { describe, expect, it } from "vitest";
import { scorePickCorrect } from "./scorePickCorrect";

const FIGHTER_A = "fighter-a";
const FIGHTER_B = "fighter-b";

describe("scorePickCorrect", () => {
  it("is true when the predicted fighter won", () => {
    expect(scorePickCorrect(FIGHTER_A, { kind: "decided", winnerId: FIGHTER_A })).toBe(true);
  });

  it("is false when the predicted fighter lost", () => {
    expect(scorePickCorrect(FIGHTER_A, { kind: "decided", winnerId: FIGHTER_B })).toBe(false);
  });

  it("is null for a void outcome -- 'who wins' has no correct answer, never scored as wrong", () => {
    expect(scorePickCorrect(FIGHTER_A, { kind: "void" })).toBeNull();
  });
});
