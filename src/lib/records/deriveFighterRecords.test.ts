import { describe, expect, it } from "vitest";
import { deriveFighterRecords } from "./deriveFighterRecords";
import type { FightForRecord } from "./deriveFighterRecords";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";
const GHOST = "99999999-9999-9999-9999-999999999999";

function fight(overrides: Partial<FightForRecord> = {}): FightForRecord {
  return {
    fighter1Id: A,
    fighter2Id: B,
    winnerId: A,
    method: "Decision (unanimous)",
    ...overrides,
  };
}

describe("deriveFighterRecords", () => {
  it("returns an empty map for no fights", () => {
    expect(deriveFighterRecords([])).toEqual(new Map());
  });

  it("credits a win to the winner and a loss to the other fighter", () => {
    const records = deriveFighterRecords([fight()]);

    expect(records.get(A)).toEqual({ wins: 1, losses: 0, draws: 0 });
    expect(records.get(B)).toEqual({ wins: 0, losses: 1, draws: 0 });
  });

  it("does not care which side of the bout the winner sits on", () => {
    // fighter1/fighter2 is an accident of sync order, not a real
    // distinction -- the same reasoning describeStanceMatchup.ts applies
    // when it canonicalizes a stance pairing.
    const records = deriveFighterRecords([fight({ winnerId: B })]);

    expect(records.get(A)).toEqual({ wins: 0, losses: 1, draws: 0 });
    expect(records.get(B)).toEqual({ wins: 1, losses: 0, draws: 0 });
  });

  it("counts a null winner with a real method as a draw for both fighters", () => {
    const records = deriveFighterRecords([fight({ winnerId: null, method: "Draw (split)" })]);

    expect(records.get(A)).toEqual({ wins: 0, losses: 0, draws: 1 });
    expect(records.get(B)).toEqual({ wins: 0, losses: 0, draws: 1 });
  });

  it("counts a No Contest as nothing at all, not as a draw", () => {
    // Officially an NC is as if the fight never happened. This is the
    // rule computeEloHistory.ts already applies to ratings, shared via
    // lib/elo/isNoContestOrAmbiguous.ts so the two can never disagree.
    const records = deriveFighterRecords([fight({ winnerId: null, method: "NC (overturned)" })]);

    expect(records.has(A)).toBe(false);
    expect(records.has(B)).toBe(false);
  });

  it("skips a null winner with a null method rather than guessing a draw", () => {
    // Ambiguous: the api_sports_only_24h settlement path writes a null
    // method, so this shape cannot be told apart from an NC. I1b proved
    // the cost of guessing here -- 10 rows would have been promoted from
    // "excluded" to "fabricated draws that move ratings."
    const records = deriveFighterRecords([fight({ winnerId: null, method: null })]);

    expect(records.has(A)).toBe(false);
    expect(records.has(B)).toBe(false);
  });

  it("skips a fight whose winner matches neither of its own two fighters", () => {
    // The I1b data-integrity case: a position-collision bug stamped a
    // different bout's winner onto the row. Such a row records a
    // factually impossible result and must not produce a record entry
    // for anyone -- including the ghost winner.
    const records = deriveFighterRecords([fight({ winnerId: GHOST })]);

    expect(records.has(A)).toBe(false);
    expect(records.has(B)).toBe(false);
    expect(records.has(GHOST)).toBe(false);
  });

  it("skips a self-fight, where both sides are the same fighter row", () => {
    // upsertFighter's name-fold can merge two identities into one row
    // (I4b dealt with exactly this class of duplicate). The artifact
    // would otherwise hand one fighter a win and a loss for one bout.
    const records = deriveFighterRecords([fight({ fighter1Id: A, fighter2Id: A, winnerId: A })]);

    expect(records.has(A)).toBe(false);
  });

  it("accumulates across many fights, on both sides of the bout", () => {
    const records = deriveFighterRecords([
      fight({ fighter1Id: A, fighter2Id: B, winnerId: A }),
      fight({ fighter1Id: C, fighter2Id: A, winnerId: C }),
      fight({ fighter1Id: A, fighter2Id: C, winnerId: null, method: "Draw (majority)" }),
      fight({ fighter1Id: B, fighter2Id: C, winnerId: B }),
    ]);

    expect(records.get(A)).toEqual({ wins: 1, losses: 1, draws: 1 });
    expect(records.get(B)).toEqual({ wins: 1, losses: 1, draws: 0 });
    expect(records.get(C)).toEqual({ wins: 1, losses: 1, draws: 1 });
  });

  it("omits a fighter whose every fight was skipped, rather than returning 0-0-0", () => {
    // "Absent" is the caller's signal to reset the stored columns to
    // zero -- recomputeFighterRecords.ts relies on this, and the UI
    // reads a 0-0-0 total as "no tracked fights" rather than as a real
    // record of no results.
    const records = deriveFighterRecords([
      fight({ fighter1Id: A, fighter2Id: B, winnerId: null, method: "NC" }),
      fight({ fighter1Id: A, fighter2Id: B, winnerId: null, method: null }),
    ]);

    expect(records.size).toBe(0);
  });

  it("does not mutate the fights it was given", () => {
    const fights = [fight()];
    const snapshot = structuredClone(fights);

    deriveFighterRecords(fights);

    expect(fights).toEqual(snapshot);
  });
});
