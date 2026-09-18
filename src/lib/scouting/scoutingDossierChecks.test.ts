import { describe, expect, it } from "vitest";
import { verifyClaims } from "../llm/verifyClaims";
import { scoutingDossierChecks } from "./scoutingDossierChecks";
import type { ScoutingDossierClaim, ScoutingFighterBundle } from "./types";

function bundle(overrides: Partial<ScoutingFighterBundle> = {}): ScoutingFighterBundle {
  return {
    fighterId: "f1",
    name: "Alexandre Pantoja",
    eloRating: 1550,
    ratedFightCount: 8,
    reachCm: 170,
    heightCm: 165,
    birthDate: "1991-05-16",
    sherdogWinsByKo: 4,
    sherdogWinsBySub: 6,
    sherdogWinsByDec: 3,
    sherdogLossesByKo: 1,
    sherdogLossesBySub: 1,
    sherdogLossesByDec: 2,
    recentBouts: [
      { id: "bout-1", result: "win", opponentName: "Kai Asakura", eventName: "UFC 310", eventDate: "2024-12-07", method: "KO/TKO" },
      { id: "bout-2", result: "win", opponentName: "Steve Erceg", eventName: "UFC 301", eventDate: "2024-05-04", method: "Decision" },
    ],
    openFlags: [{ id: "flag-1", category: "weight_cut", summary: "Reported struggling to make weight." }],
    ...overrides,
  };
}

function facts(bundles: ScoutingFighterBundle[]) {
  return { bundlesByFighterId: new Map(bundles.map((b) => [b.fighterId, b])) };
}

function claim(overrides: Partial<ScoutingDossierClaim> = {}): ScoutingDossierClaim {
  return {
    fighterId: "f1",
    formTrajectory: "Won two straight, both finishes.",
    stylisticProfile: "Finishes via decision or KO in recent form.",
    durability: "Has only been finished once by KO in the sample shown.",
    layoff: "Last fought roughly seven months before this card.",
    citedBoutIds: ["bout-1", "bout-2"],
    citedFlagIds: ["flag-1"],
    ...overrides,
  };
}

describe("scoutingDossierChecks", () => {
  it("keeps a dossier whose citations are all real for this fighter", () => {
    const result = verifyClaims([claim()], facts([bundle()]), scoutingDossierChecks);
    expect(result.kept).toEqual([claim()]);
  });

  it("keeps a dossier that cites no flags at all", () => {
    const c = claim({ citedFlagIds: [] });
    const result = verifyClaims([c], facts([bundle()]), scoutingDossierChecks);
    expect(result.kept).toEqual([c]);
  });

  it("drops a dossier for a fighter that no longer exists in facts", () => {
    const c = claim({ fighterId: "nonexistent" });
    const result = verifyClaims([c], facts([bundle()]), scoutingDossierChecks);
    expect(result.kept).toEqual([]);
    expect(result.dropReasons).toEqual({ unknown_fighter_id: 1 });
  });

  // Never trust an invented bout id, the same rule every other surface's
  // checks apply to a model-cited value. Drops the whole claim -- a
  // fabricated citation undermines the prose reasoning around it, not
  // just the citation list.
  it("drops a dossier citing a bout id that isn't in this fighter's own bundle", () => {
    const c = claim({ citedBoutIds: ["bout-1", "bout-fake"] });
    const result = verifyClaims([c], facts([bundle()]), scoutingDossierChecks);
    expect(result.kept).toEqual([]);
    expect(result.dropReasons).toEqual({ fabricated_bout_id: 1 });
  });

  it("drops a dossier citing a flag id that isn't in this fighter's own bundle", () => {
    const c = claim({ citedFlagIds: ["flag-fake"] });
    const result = verifyClaims([c], facts([bundle()]), scoutingDossierChecks);
    expect(result.kept).toEqual([]);
    expect(result.dropReasons).toEqual({ fabricated_flag_id: 1 });
  });

  // The load-bearing case: a bout id real for a DIFFERENT fighter must
  // still be rejected for this one -- each fighter's own bundle is the
  // only real source of truth for their own citations.
  it("checks citations against the RIGHT fighter's bundle, not any bundle in facts", () => {
    const other = bundle({
      fighterId: "f2",
      recentBouts: [{ id: "bout-only-on-f2", result: "loss", opponentName: "Someone", eventName: null, eventDate: null, method: null }],
    });
    const c = claim({ fighterId: "f1", citedBoutIds: ["bout-only-on-f2"] });
    const result = verifyClaims([c], facts([bundle(), other]), scoutingDossierChecks);
    expect(result.kept).toEqual([]);
    expect(result.dropReasons).toEqual({ fabricated_bout_id: 1 });
  });
});
