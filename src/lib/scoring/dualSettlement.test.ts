import { describe, expect, it } from "vitest";
import { scorePickCorrect } from "./scorePickCorrect";
import { scoreBetPnl } from "./scoreBetPnl";
import type { FightOutcome } from "./types";

// ARCHITECTURE.md item #3, the case it names explicitly as needing a
// test: a pick and a bet on different fighters must settle
// independently, neither line inheriting the other's correctness. The
// architecture doc's own wording of that one scenario doesn't parse for
// a two-fighter fight taken literally (a fighter can't simultaneously be
// "predicted right" and have "the other fighter's bet win"), so this
// covers BOTH directions the divergence can go -- strictly more coverage
// than picking one, and the only way to be certain the actual intended
// case is included either way.
const FIGHTER_A = "fighter-a";
const FIGHTER_B = "fighter-b";
const STAKE = 10;
const PRICE = 3.5; // an underdog price -- makes a winning bet unmistakably positive

describe("dual settlement independence", () => {
  it("prediction WRONG, bet on the (winning) other fighter -- pick_correct false, pnl_units positive", () => {
    // Predicted A, A loses (B wins); bet is on B, the actual winner. The
    // PRD's own headline example: an underdog you think loses can still
    // be the correct bet.
    const outcome: FightOutcome = { kind: "decided", winnerId: FIGHTER_B };
    const pickCorrect = scorePickCorrect(FIGHTER_A, outcome);
    const pnlUnits = scoreBetPnl(FIGHTER_B, STAKE, PRICE, outcome);

    expect(pickCorrect).toBe(false);
    expect(pnlUnits).toBeGreaterThan(0);
  });

  it("prediction RIGHT, bet on the (losing) other fighter -- pick_correct true, pnl_units negative", () => {
    // Predicted A, A wins; bet is on B, the actual loser -- backing the
    // fighter you did NOT predict, and losing that stake, while still
    // being right about who wins.
    const outcome: FightOutcome = { kind: "decided", winnerId: FIGHTER_A };
    const pickCorrect = scorePickCorrect(FIGHTER_A, outcome);
    const pnlUnits = scoreBetPnl(FIGHTER_B, STAKE, PRICE, outcome);

    expect(pickCorrect).toBe(true);
    expect(pnlUnits).toBeLessThan(0);
  });

  it("neither line inherits the other's fighter -- a bug that settled pnl_units off predicted_fighter_id instead of bet_fighter_id would flip both signs above", () => {
    // Explicit regression guard for the exact bug class item #3 exists to
    // catch: computing both lines from the same winner-matches-predicted
    // check instead of scoring the bet against bet_fighter_id.
    const outcome: FightOutcome = { kind: "decided", winnerId: FIGHTER_B };
    const buggyPnlUsingPredictedFighter = scoreBetPnl(FIGHTER_A, STAKE, PRICE, outcome);
    const correctPnlUsingBetFighter = scoreBetPnl(FIGHTER_B, STAKE, PRICE, outcome);
    expect(correctPnlUsingBetFighter).not.toBe(buggyPnlUsingPredictedFighter);
    expect(correctPnlUsingBetFighter).toBeGreaterThan(0);
    expect(buggyPnlUsingPredictedFighter).toBeLessThan(0);
  });
});
