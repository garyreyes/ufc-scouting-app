import { describe, expect, it } from "vitest";
import { fightOutcomeFromSettledFight } from "./fightOutcomeFromSettledFight";

// The bridge between D1's schema (fights.winner_id, authoritative once
// settled_at is set) and C2's pure scoring functions, which only ever
// know about FightOutcome. A settled fight's winner_id is null exactly
// for a void outcome (draw/NC -- see lib/settlement/evaluateFightSettlement.ts's
// wikipedia_draw_or_nc case) -- there's no third state to worry about
// here, since this only ever runs against a fight that's already settled.
const FIGHTER_A = "fighter-a";

describe("fightOutcomeFromSettledFight", () => {
  it("returns a decided outcome when winnerId is set", () => {
    expect(fightOutcomeFromSettledFight(FIGHTER_A)).toEqual({ kind: "decided", winnerId: FIGHTER_A });
  });

  it("returns a void outcome when winnerId is null", () => {
    expect(fightOutcomeFromSettledFight(null)).toEqual({ kind: "void" });
  });
});
