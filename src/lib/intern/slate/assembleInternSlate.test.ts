import { describe, expect, it } from "vitest";
import { assembleInternSlate } from "./assembleInternSlate";
import type { SlateFight } from "./types";

// A six-fight priced card plus one unpriced fight. Every expected number
// below is hand-computed from these inputs.
function fight(o: Partial<SlateFight> & { fightId: string }): SlateFight {
  return {
    fighter1Id: `${o.fightId}-1`,
    fighter2Id: `${o.fightId}-2`,
    fighter1Name: `${o.fightId.toUpperCase()} One`,
    fighter2Name: `${o.fightId.toUpperCase()} Two`,
    odds: null,
    predictedFighterId: `${o.fightId}-1`,
    estimatedProbability: 0.6,
    confidence: 3,
    predictedMethod: "DECISION",
    methodDistribution: { dec: 0.5, ko: 0.3, sub: 0.2 },
    betFighterId: null,
    ...o,
  };
}

const CARD: SlateFight[] = [
  // Market P(f1) 0.6889. Safe-parlay leg.
  fight({ fightId: "a", odds: { fighter1Price: 1.4, fighter2Price: 3.1 }, estimatedProbability: 0.72, confidence: 4, methodDistribution: { dec: 0.55, ko: 0.3, sub: 0.15 } }),
  // Market 0.7706. Safe-parlay leg; the best method leg (KO, 0.48).
  fight({ fightId: "b", odds: { fighter1Price: 1.25, fighter2Price: 4.2 }, estimatedProbability: 0.8, confidence: 5, predictedMethod: "KO_TKO", methodDistribution: { dec: 0.3, ko: 0.6, sub: 0.1 } }),
  // Market 0.6049. Safe-parlay leg (conf 3).
  fight({ fightId: "c", odds: { fighter1Price: 1.6, fighter2Price: 2.45 }, estimatedProbability: 0.66, confidence: 3, predictedMethod: "SUBMISSION", methodDistribution: { dec: 0.4, ko: 0.2, sub: 0.4 } }),
  // Fighter 2 favoured at 0.63 -- below the safe-parlay 0.65 bar.
  fight({ fightId: "d", odds: { fighter1Price: 2.3, fighter2Price: 1.67 }, predictedFighterId: "d-2", estimatedProbability: 0.63, confidence: 3, predictedMethod: "FINISH", methodDistribution: { dec: 0.35, ko: 0.4, sub: 0.25 } }),
  // The one v2 value bet: P(f2) 0.42 vs market 0.3735 at 2.60 -> EV +9.2%.
  fight({ fightId: "e", odds: { fighter1Price: 1.55, fighter2Price: 2.6 }, estimatedProbability: 0.58, confidence: 2, betFighterId: "e-2" }),
  fight({ fightId: "f", odds: { fighter1Price: 1.9, fighter2Price: 1.95 }, estimatedProbability: 0.56, confidence: 2, methodDistribution: { dec: 0.6, ko: 0.25, sub: 0.15 } }),
  // Unpriced: excluded from every slip even though its number looks good.
  fight({ fightId: "g", estimatedProbability: 0.9, confidence: 5 }),
];

function slip(archetype: string, balance = 10000) {
  return assembleInternSlate(CARD, balance).filter((s) => s.archetype === archetype);
}

describe("assembleInternSlate", () => {
  it("value bets: one single per v2 underdog bet, staked at quarter-Kelly of the bankroll under its 30% share", () => {
    const [single, ...rest] = slip("STRAIGHT_DOG");
    expect(rest).toHaveLength(0);
    expect(single.legs).toEqual([
      expect.objectContaining({ fightId: "e", market: "MONEYLINE", selectionFighterId: "e-2", price: 2.6, priceSource: "book" }),
    ]);
    expect(single.legs[0].modelProbability).toBeCloseTo(0.42, 10);
    // Quarter-Kelly: 0.25 x 0.092 / 1.6 = 1.4375% of 10,000 = 143.75 -> 143 (under the 300 share).
    expect(single.stakePhp).toBe(143);
  });

  it("confident parlay: p >= 0.65, conf >= 3, not against the market, ranked by p (B, A, C)", () => {
    const [parlay] = slip("SAFE_PARLAY");
    expect(parlay.legs.map((l) => l.fightId)).toEqual(["b", "a", "c"]);
    expect(parlay.combinedPrice).toBe(2.8); // 1.25 x 1.40 x 1.60
    expect(parlay.modelProbability).toBeCloseTo(0.8 * 0.72 * 0.66, 10);
    expect(parlay.stakePhp).toBe(300); // 30% of the 1,000 card budget
  });

  it("longshot moneylines: every favoured side at p >= 0.55, priced fights only", () => {
    const [parlay] = slip("LONGSHOT");
    expect(parlay.legs.map((l) => `${l.fightId}:${l.selectionFighterId}`)).toEqual([
      "b:b-1", "a:a-1", "c:c-1", "d:d-2", "e:e-1", "f:f-1",
    ]);
    // 1.25 x 1.40 x 1.60 x 1.67 x 1.55 x 1.90 = 13.77082
    expect(parlay.combinedPrice).toBe(13.771);
    expect(parlay.stakePhp).toBe(125);
  });

  it("method single: the most likely fighter-and-method, B by KO at 0.48, estimated at 1.74", () => {
    const [single] = slip("METHOD_SINGLE");
    expect(single.legs).toEqual([
      expect.objectContaining({ fightId: "b", market: "METHOD_FIGHTER", selectionFighterId: "b-1", methodGroup: "KO_TKO_DQ", price: 1.74, priceSource: "estimated" }),
    ]);
    expect(single.legs[0].modelProbability).toBeCloseTo(0.48, 10);
    expect(single.stakePhp).toBe(150);
  });

  it("method parlay: every leg at P >= 0.30, capped at 4, using the Intern's own method call", () => {
    const [parlay] = slip("METHOD_PARLAY");
    expect(parlay.legs.map((l) => `${l.fightId}:${l.methodGroup}:${l.price}`)).toEqual([
      "b:KO_TKO_DQ:1.74", // 0.8  x 0.6  = 0.48
      "d:ANY_FINISH:2.04", // 0.63 x 0.65 = 0.4095 -> 1 / 0.4914 = 2.035002
      "a:DECISION:2.1", // 0.72 x 0.55 = 0.396
      "f:DECISION:2.48", // 0.56 x 0.6  = 0.336 (e at 0.29 and c at 0.264 miss the bar)
    ]);
    expect(parlay.combinedPrice).toBe(18.486); // 1.74 x 2.04 x 2.10 x 2.48
    expect(parlay.stakePhp).toBe(125);
  });

  it("never spends more than 10% of the bankroll on a card", () => {
    const total = assembleInternSlate(CARD, 10000).reduce((s, x) => s + x.stakePhp, 0);
    expect(total).toBe(843); // 143 + 300 + 125 + 125 + 150
  });

  it("scales stakes with the current balance, not the opening ₱10,000", () => {
    expect(slip("SAFE_PARLAY", 8000)[0].stakePhp).toBe(240);
  });

  it("builds nothing from an empty bankroll", () => {
    expect(assembleInternSlate(CARD, 0)).toEqual([]);
  });

  it("drops a parlay type that can't reach its minimum legs, rather than padding it", () => {
    const thin = CARD.filter((f) => ["b", "g"].includes(f.fightId));
    const archetypes = assembleInternSlate(thin, 10000).map((s) => s.archetype);
    expect(archetypes).not.toContain("SAFE_PARLAY");
    expect(archetypes).not.toContain("LONGSHOT");
    expect(archetypes).not.toContain("METHOD_PARLAY");
    expect(archetypes).toContain("METHOD_SINGLE");
  });

  it("skips the method single when no leg reaches P 0.35", () => {
    // All DECISION calls at 0.34: best leg is B, 0.8 x 0.34 = 0.272. (A FINISH
    // call would sum KO + sub and clear the bar.)
    const weak = CARD.map((f) => ({
      ...f,
      predictedMethod: "DECISION" as const,
      methodDistribution: { dec: 0.34, ko: 0.33, sub: 0.33 },
    }));
    expect(assembleInternSlate(weak, 10000).map((s) => s.archetype)).not.toContain("METHOD_SINGLE");
  });

  it("never puts two legs from the same fight in one slip, and is deterministic", () => {
    const a = assembleInternSlate(CARD, 10000);
    for (const s of a) expect(new Set(s.legs.map((l) => l.fightId)).size).toBe(s.legs.length);
    expect(assembleInternSlate([...CARD].reverse(), 10000)).toEqual(a);
  });

  // Found replaying the 2026-09-26 card: the most likely method leg was a
  // 93% favourite "by finish" at an estimated 1.18 -- a near-lock, not a
  // method bet. Method slips need a price worth betting.
  it("method legs must pay: single >= 1.50, parlay legs >= 1.30", () => {
    const heavy = fight({
      fightId: "h",
      odds: { fighter1Price: 1.08, fighter2Price: 9 },
      estimatedProbability: 0.93,
      confidence: 5,
      predictedMethod: "FINISH",
      methodDistribution: { dec: 0.25, ko: 0.6, sub: 0.15 }, // 0.93 x 0.75 = 0.6975 -> est. 1.19
    });
    const slate = assembleInternSlate([...CARD, heavy], 10000);
    const single = slate.find((s) => s.archetype === "METHOD_SINGLE")!;
    expect(single.legs[0].fightId).toBe("b"); // not h
    const parlay = slate.find((s) => s.archetype === "METHOD_PARLAY")!;
    expect(parlay.legs.map((l) => l.fightId)).not.toContain("h");
  });

  // Also from that replay: prelim newcomers are confidence-capped at 2 by
  // their thin Elo history, which kept every leg out of the confident
  // parlay even at 70%+. v2's number is mostly the market's, so the
  // probability bar -- not the Elo-sample cap -- is what gates it.
  it("confident parlay admits a confidence-2 leg that clears the probability bar", () => {
    const newcomer = CARD.map((f) => (f.fightId === "c" ? { ...f, confidence: 2 } : f));
    const [parlay] = assembleInternSlate(newcomer, 10000).filter((s) => s.archetype === "SAFE_PARLAY");
    expect(parlay.legs.map((l) => l.fightId)).toEqual(["b", "a", "c"]);
  });
});
