import { describe, expect, it } from "vitest";
import { computeScoutingInputHash } from "./computeScoutingInputHash";
import { buildScoutingDossierPrompt } from "./buildScoutingDossierPrompt";
import type { ScoutingFighterBundle } from "./types";

// N7's own named risk (ROADMAP.md/plan): "cache key omits a field the
// prompt uses -> stale dossiers served forever, invisibly." The design
// forecloses this structurally -- the hash covers the WHOLE bundle, and
// the prompt builder can only ever read from a bundle -- but this test
// still exercises the guarantee directly: every field, when changed,
// must change BOTH the hash and the rendered prompt text. A field that
// changed the hash but not the prompt (or vice versa) would mean the two
// had quietly drifted apart, exactly the failure this exists to catch.
function baseBundle(): ScoutingFighterBundle {
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
      {
        id: "bout-1",
        result: "win",
        opponentName: "Kai Asakura",
        eventName: "UFC 310",
        eventDate: "2024-12-07",
        method: "KO/TKO",
      },
    ],
    openFlags: [{ id: "flag-1", category: "weight_cut", summary: "Reported struggling to make weight." }],
  };
}

const fieldMutations: [string, (b: ScoutingFighterBundle) => ScoutingFighterBundle][] = [
  ["fighterId", (b) => ({ ...b, fighterId: "f-different" })],
  ["name", (b) => ({ ...b, name: "Someone Else" })],
  ["eloRating", (b) => ({ ...b, eloRating: b.eloRating + 50 })],
  ["ratedFightCount", (b) => ({ ...b, ratedFightCount: b.ratedFightCount + 1 })],
  ["reachCm", (b) => ({ ...b, reachCm: 200 })],
  ["heightCm", (b) => ({ ...b, heightCm: 200 })],
  ["birthDate", (b) => ({ ...b, birthDate: "1990-01-01" })],
  ["sherdogWinsByKo", (b) => ({ ...b, sherdogWinsByKo: 99 })],
  ["sherdogWinsBySub", (b) => ({ ...b, sherdogWinsBySub: 99 })],
  ["sherdogWinsByDec", (b) => ({ ...b, sherdogWinsByDec: 99 })],
  ["sherdogLossesByKo", (b) => ({ ...b, sherdogLossesByKo: 99 })],
  ["sherdogLossesBySub", (b) => ({ ...b, sherdogLossesBySub: 99 })],
  ["sherdogLossesByDec", (b) => ({ ...b, sherdogLossesByDec: 99 })],
  [
    "recentBouts",
    (b) => ({
      ...b,
      recentBouts: [{ id: "bout-2", result: "loss", opponentName: "Different Opponent", eventName: null, eventDate: null, method: null }],
    }),
  ],
  ["openFlags", (b) => ({ ...b, openFlags: [{ id: "flag-2", category: "injury", summary: "A different concern entirely." }] })],
];

describe("computeScoutingInputHash / buildScoutingDossierPrompt cache-key parity", () => {
  it("is deterministic: the same bundle always hashes and renders identically", () => {
    const a = baseBundle();
    const b = baseBundle();
    expect(computeScoutingInputHash(a)).toBe(computeScoutingInputHash(b));
    expect(buildScoutingDossierPrompt(a)).toBe(buildScoutingDossierPrompt(b));
  });

  it.each(fieldMutations)("changing %s changes both the hash and the rendered prompt", (_field, mutate) => {
    const original = baseBundle();
    const mutated = mutate(baseBundle());

    expect(computeScoutingInputHash(mutated)).not.toBe(computeScoutingInputHash(original));
    expect(buildScoutingDossierPrompt(mutated)).not.toBe(buildScoutingDossierPrompt(original));
  });

  it("covers every ScoutingFighterBundle field in the mutation table above", () => {
    // A structural reminder, not a runtime check on the type itself: if a
    // new field is ever added to ScoutingFighterBundle without a matching
    // entry above, this count silently stops matching -- the mismatch is
    // easy to miss in review, so it's named here explicitly.
    const bundleFieldCount = Object.keys(baseBundle()).length;
    expect(fieldMutations.length).toBe(bundleFieldCount);
  });
});
