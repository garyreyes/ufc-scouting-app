import { describe, expect, it } from "vitest";
import { verifyClaims } from "../llm/verifyClaims";
import { retractionChecks } from "./retractionChecks";
import type { CandidatePost, OpenFlagForRetraction, RetractionClaim } from "./types";

const fighter1 = { id: "f1", name: "Chidi Njokuani" };
const fighter2 = { id: "f2", name: "Michael Page" };

function flag(overrides: Partial<OpenFlagForRetraction> = {}): OpenFlagForRetraction {
  return {
    id: "flag-1",
    fightId: "fight-1",
    fighterId: fighter1.id,
    fighter1,
    fighter2,
    category: "weight_cut",
    summary: "Reported to have missed weight.",
    mostRecentSourceAt: "2026-09-14T10:00:00Z",
    ...overrides,
  };
}

function post(overrides: Partial<CandidatePost> = {}): CandidatePost {
  return {
    uri: "at://newer-post",
    authorHandle: "someone.bsky.social",
    text: "Njokuani made weight comfortably this morning.",
    externalUrl: null,
    createdAt: "2026-09-16T09:00:00Z",
    ...overrides,
  };
}

function facts(flags: OpenFlagForRetraction[], posts: CandidatePost[]) {
  return {
    flagsById: new Map(flags.map((f) => [f.id, f])),
    postsByUri: new Map(posts.map((p) => [p.uri, p])),
  };
}

function keep(overrides: Partial<RetractionClaim> = {}): RetractionClaim {
  return { flagId: "flag-1", action: "keep", supersededByUri: null, rationale: "still current", ...overrides };
}

function retract(overrides: Partial<RetractionClaim> = {}): RetractionClaim {
  return {
    flagId: "flag-1",
    action: "retract",
    supersededByUri: "at://newer-post",
    rationale: "made weight",
    ...overrides,
  };
}

describe("retractionChecks", () => {
  it("keeps a well-formed retraction backed by a real, strictly newer, correctly-attributed post", () => {
    const f = facts([flag()], [post()]);
    const result = verifyClaims([retract()], f, retractionChecks);
    expect(result.kept).toEqual([retract()]);
    expect(result.droppedCount).toBe(0);
  });

  it("keeps a well-formed 'keep' decision unconditionally -- it needs no superseding post", () => {
    const f = facts([flag()], []);
    const result = verifyClaims([keep()], f, retractionChecks);
    expect(result.kept).toEqual([keep()]);
  });

  it("drops a claim whose flagId does not resolve to a real open flag", () => {
    const f = facts([flag()], [post()]);
    const result = verifyClaims([retract({ flagId: "nonexistent-flag" })], f, retractionChecks);
    expect(result.kept).toEqual([]);
    expect(result.dropReasons).toEqual({ unknown_flag_id: 1 });
  });

  it("drops a retraction whose supersededByUri is not a real known post -- never trusts an invented uri", () => {
    const f = facts([flag()], [post()]);
    const result = verifyClaims([retract({ supersededByUri: "at://made-up" })], f, retractionChecks);
    expect(result.kept).toEqual([]);
    expect(result.dropReasons).toEqual({ unknown_source_uri: 1 });
  });

  it("drops a retraction with no supersededByUri at all", () => {
    const f = facts([flag()], [post()]);
    const result = verifyClaims([retract({ supersededByUri: null })], f, retractionChecks);
    expect(result.dropReasons).toEqual({ unknown_source_uri: 1 });
  });

  // The exact-value assertion the plan calls for: a flag retracted by a
  // post OLDER than one of its own sources must be kept, not retracted --
  // this is the whole reason the check compares real dates instead of
  // trusting the model's own "this is newer" framing.
  it("drops a retraction whose superseding post is OLDER than the flag's own most recent source -- keeps the flag", () => {
    const f = facts(
      [flag({ mostRecentSourceAt: "2026-09-16T10:00:00Z" })],
      [post({ createdAt: "2026-09-14T10:00:00Z" })], // older than the flag's own source
    );
    const result = verifyClaims([retract()], f, retractionChecks);
    expect(result.kept).toEqual([]);
    expect(result.dropReasons).toEqual({ superseding_post_not_newer: 1 });
  });

  it("drops a retraction whose superseding post is exactly as old as the flag's source -- strictly newer required", () => {
    const f = facts([flag({ mostRecentSourceAt: "2026-09-16T09:00:00Z" })], [post({ createdAt: "2026-09-16T09:00:00Z" })]);
    const result = verifyClaims([retract()], f, retractionChecks);
    expect(result.dropReasons).toEqual({ superseding_post_not_newer: 1 });
  });

  it("keeps a retraction whose superseding post is even one second newer", () => {
    const f = facts([flag({ mostRecentSourceAt: "2026-09-16T09:00:00.000Z" })], [post({ createdAt: "2026-09-16T09:00:01.000Z" })]);
    const result = verifyClaims([retract()], f, retractionChecks);
    expect(result.kept).toHaveLength(1);
  });

  // The other half of "never trust the model's own attribution": the
  // superseding post's TEXT must actually name the flagged fighter --
  // determined independently via findFighterMentionInText, never taken
  // from anything the model claims (the claim schema doesn't even have a
  // fighter field for this reason).
  it("drops a retraction whose superseding post is about the OTHER fighter in the bout", () => {
    const f = facts([flag({ fighterId: fighter1.id })], [post({ text: "Michael Page made weight with no issues." })]);
    const result = verifyClaims([retract()], f, retractionChecks);
    expect(result.kept).toEqual([]);
    expect(result.dropReasons).toEqual({ superseding_post_wrong_fighter: 1 });
  });

  it("drops a retraction whose superseding post mentions neither fighter", () => {
    const f = facts([flag()], [post({ text: "Completely unrelated news about a different card entirely." })]);
    const result = verifyClaims([retract()], f, retractionChecks);
    expect(result.dropReasons).toEqual({ superseding_post_wrong_fighter: 1 });
  });

  it("drops a claim whose action is neither keep nor retract", () => {
    const f = facts([flag()], [post()]);
    const result = verifyClaims(
      [{ ...retract(), action: "maybe" as unknown as RetractionClaim["action"] }],
      f,
      retractionChecks,
    );
    expect(result.dropReasons).toEqual({ invalid_action: 1 });
  });

  it("processes multiple claims independently -- one bad claim does not affect another", () => {
    const f = facts(
      [flag({ id: "flag-1", fighterId: fighter1.id }), flag({ id: "flag-2", fighterId: fighter2.id, category: "injury" })],
      [post({ uri: "at://p1", text: "Njokuani made weight." }), post({ uri: "at://p2", text: "Page cleared to fight, fully healthy." })],
    );
    const result = verifyClaims(
      [
        retract({ flagId: "flag-1", supersededByUri: "at://p1" }),
        retract({ flagId: "flag-2", supersededByUri: "at://p2" }),
      ],
      f,
      retractionChecks,
    );
    expect(result.kept).toHaveLength(2);
  });
});
