import { describe, expect, it } from "vitest";
import {
  AUTO_MATCH_THRESHOLD,
  decideFighterMatch,
  rankFighterCandidates,
} from "./matchFighterCandidate";
import type { FighterSearchCandidate } from "./searchFighters";

function candidate(externalId: string, name: string): FighterSearchCandidate {
  return {
    externalId,
    name,
    heightCm: null,
    reachCm: null,
    weightKg: null,
    weightClass: null,
    stance: null,
    nickname: null,
    team: null,
  };
}

describe("decideFighterMatch", () => {
  // A search returning nothing is the expected shape for a real
  // debutant or a very recent signee -- not itself a conflict, same
  // reasoning matchFights.ts's decideMatch already applies to
  // no_candidates ("most Odds API events simply aren't about any fight
  // we're tracking, and that's expected, not ambiguous").
  it("is no_candidates when the search returns nothing", () => {
    expect(decideFighterMatch("Some Debutant", [])).toEqual({ kind: "no_candidates" });
  });

  it("matches an exact name with high confidence", () => {
    const result = decideFighterMatch("Alexandre Pantoja", [candidate("250", "Alexandre Pantoja")]);
    expect(result).toEqual({ kind: "matched", externalId: "250", confidence: 1 });
  });

  // Live-verified 2026-09-03: search "Hooker" -> exactly "Dan Hooker".
  // Coded as a fixture rather than assumed, since a fuzzy match on a
  // real name is exactly the kind of thing worth pinning to a concrete
  // case.
  it("matches the real Dan Hooker search result", () => {
    const result = decideFighterMatch("Dan Hooker", [candidate("516", "Dan Hooker")]);
    expect(result.kind).toBe("matched");
  });

  it("queues a low-confidence single candidate rather than auto-matching or dropping it", () => {
    const result = decideFighterMatch("Jon Jones", [candidate("1", "John Jonas")]);
    expect(result.kind).toBe("low_confidence");
  });

  it("picks the best of several candidates, not just the first", () => {
    const result = decideFighterMatch("Israel Adesanya", [
      candidate("1", "Israel Adekunle"),
      candidate("2", "Israel Adesanya"),
      candidate("3", "Isaiah Adams"),
    ]);
    expect(result).toEqual({ kind: "matched", externalId: "2", confidence: 1 });
  });

  it("is deterministic -- identical input always produces identical output", () => {
    const storedName = "Charles Oliveira";
    const candidates = [candidate("1", "Charles Oliveira")];
    expect(decideFighterMatch(storedName, candidates)).toEqual(decideFighterMatch(storedName, candidates));
  });

  it("AUTO_MATCH_THRESHOLD is a real, meaningful bar, not zero or one", () => {
    expect(AUTO_MATCH_THRESHOLD).toBeGreaterThan(0);
    expect(AUTO_MATCH_THRESHOLD).toBeLessThan(1);
  });
});

describe("rankFighterCandidates", () => {
  // The owner's own review screen (mirroring rankFightMatches' role in
  // B6's low-confidence odds queue) needs every real candidate, not just
  // the algorithm's best guess, so a wrong top pick can be corrected
  // rather than only ever rubber-stamped.
  it("returns every candidate, exact match sorted first", () => {
    const ranked = rankFighterCandidates("Israel Adesanya", [
      candidate("1", "Isaiah Adams"),
      candidate("2", "Israel Adesanya"),
      candidate("3", "Israel Adekunle"),
    ]);
    expect(ranked).toHaveLength(3);
    expect(ranked[0].externalId).toBe("2");
    expect(ranked[0].confidence).toBe(1);
  });

  it("sorts strictly by descending confidence", () => {
    const ranked = rankFighterCandidates("Israel Adesanya", [
      candidate("1", "Isaiah Adams"),
      candidate("2", "Israel Adesanya"),
      candidate("3", "Israel Adekunle"),
    ]);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].confidence).toBeGreaterThanOrEqual(ranked[i].confidence);
    }
  });
});
