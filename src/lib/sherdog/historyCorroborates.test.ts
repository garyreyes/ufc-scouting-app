import { describe, it, expect } from "vitest";
import { historyCorroborates, type KnownOpponentBout } from "./historyCorroborates";
import type { SherdogHistoryFight } from "./parseFightHistory";

function bout(opponentName: string, date: string | null): SherdogHistoryFight {
  return {
    result: "win",
    opponentName,
    opponentSherdogId: null,
    eventName: null,
    eventSherdogId: null,
    date,
    method: null,
    referee: null,
    round: null,
    time: null,
  };
}

describe("historyCorroborates (M5)", () => {
  // Real shape, verified live 2026-09-17: our own "Patrício Pitbull" has
  // fights vs. Aaron Pico (2026-04-11), Dan Ige (2025-07-19), and Yair
  // Rodríguez (2025-04-12) in our own `fights` table. The real Sherdog
  // page for "Patricio Freire" (sherdogId 9960 -- the LOWER name-
  // similarity candidate against "Patrício Pitbull") lists all three at
  // matching (or near-matching) dates.
  const knownBouts: KnownOpponentBout[] = [
    { opponentName: "Aaron Pico", eventDate: "2026-04-11" },
    { opponentName: "Dan Ige", eventDate: "2025-07-19" },
    { opponentName: "Yair Rodríguez", eventDate: "2025-04-12" },
  ];

  it("corroborates when a candidate's history has an exact-date match against a known opponent", () => {
    const history = [bout("Aaron Pico", "Apr / 11 / 2026")];
    expect(historyCorroborates(knownBouts, history)).toBe(true);
  });

  it("corroborates within the +/-10 day window, not just an exact date", () => {
    // Our stored date is 2025-04-12; Sherdog's own page prints
    // "Apr / 12 / 2025" for the same bout -- but even a few days'
    // discrepancy between the two sources' own records must still count.
    const history = [bout("Yair Rodriguez", "Apr / 15 / 2025")]; // 3 days later, diacritic dropped
    expect(historyCorroborates(knownBouts, history)).toBe(true);
  });

  it("does not corroborate past the 10-day window", () => {
    const history = [bout("Aaron Pico", "Apr / 25 / 2026")]; // 14 days later
    expect(historyCorroborates(knownBouts, history)).toBe(false);
  });

  it("does not corroborate on a name match with no date, or a date match with no name", () => {
    const history = [bout("Aaron Pico", null), bout("Someone Else", "2026-04-11")];
    expect(historyCorroborates(knownBouts, history)).toBe(false);
  });

  it("does not corroborate an unrelated fighter's history (the namesake case)", () => {
    // "Patricio Lima" -- the WRONG candidate, a namesake with no real
    // overlap with our fighter's actual career.
    const history = [
      bout("Someone Local", "Jan / 05 / 2019"),
      bout("Another Regional Fighter", "Jun / 20 / 2021"),
    ];
    expect(historyCorroborates(knownBouts, history)).toBe(false);
  });

  it("returns false against an empty history or an empty known-bout list", () => {
    expect(historyCorroborates(knownBouts, [])).toBe(false);
    expect(historyCorroborates([], [bout("Aaron Pico", "Apr / 11 / 2026")])).toBe(false);
  });
});
