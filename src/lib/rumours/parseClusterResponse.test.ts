import { describe, expect, it } from "vitest";
import { parseClusterResponse } from "./parseClusterResponse";
import type { CandidatePost } from "./types";

const fighter1 = { id: "f1", name: "Chidi Njokuani" };
const fighter2 = { id: "f2", name: "Michael Page" };

function post(uri: string, text = "some post text"): CandidatePost {
  return { uri, authorHandle: "someone.bsky.social", text, externalUrl: null, createdAt: "2026-09-01T00:00:00Z" };
}

const knownPosts = [
  post("uri-1", "Njokuani reportedly missed weight by six pounds at this morning's weigh-in."),
  post("uri-2", "A totally different account says Njokuani struggled badly on the scale today, way worse than expected."),
  post("uri-3", "Unrelated post about a different bout entirely."),
];

describe("parseClusterResponse", () => {
  it("accepts a well-formed flag referencing real posts", () => {
    const raw = {
      flags: [
        {
          fighter: "Chidi Njokuani",
          category: "weight_cut",
          summary: "Reported to have missed weight by six pounds.",
          sourceUris: ["uri-1", "uri-2"],
        },
      ],
    };

    const flags = parseClusterResponse(raw, knownPosts, fighter1, fighter2);

    expect(flags).toHaveLength(1);
    expect(flags[0].fighterId).toBe("f1");
    expect(flags[0].category).toBe("weight_cut");
    expect(flags[0].sources.map((s) => s.uri)).toEqual(["uri-1", "uri-2"]);
  });

  it("accepts the 'other' category", () => {
    const raw = {
      flags: [
        { fighter: "Chidi Njokuani", category: "other", summary: "Facing a legal issue.", sourceUris: ["uri-1"] },
      ],
    };
    expect(parseClusterResponse(raw, knownPosts, fighter1, fighter2)[0].category).toBe("other");
  });

  it("drops a flag whose fighter name doesn't resolve to either real fighter", () => {
    const raw = {
      flags: [
        { fighter: "Jon Jones", category: "injury", summary: "...", sourceUris: ["uri-1"] },
      ],
    };
    expect(parseClusterResponse(raw, knownPosts, fighter1, fighter2)).toHaveLength(0);
  });

  it("drops a flag with an invalid category rather than guess-mapping it", () => {
    const raw = {
      flags: [
        { fighter: "Chidi Njokuani", category: "drug_test", summary: "...", sourceUris: ["uri-1"] },
      ],
    };
    expect(parseClusterResponse(raw, knownPosts, fighter1, fighter2)).toHaveLength(0);
  });

  it("drops hallucinated source URIs but keeps the flag if a real one remains", () => {
    const raw = {
      flags: [
        {
          fighter: "Chidi Njokuani",
          category: "weight_cut",
          summary: "...",
          sourceUris: ["uri-1", "made-up-uri-that-does-not-exist"],
        },
      ],
    };
    const flags = parseClusterResponse(raw, knownPosts, fighter1, fighter2);
    expect(flags).toHaveLength(1);
    expect(flags[0].sources.map((s) => s.uri)).toEqual(["uri-1"]);
  });

  it("drops the whole flag when every source URI is hallucinated", () => {
    const raw = {
      flags: [
        {
          fighter: "Chidi Njokuani",
          category: "weight_cut",
          summary: "...",
          sourceUris: ["fake-1", "fake-2"],
        },
      ],
    };
    expect(parseClusterResponse(raw, knownPosts, fighter1, fighter2)).toHaveLength(0);
  });

  it("collapses near-duplicate resolved sources within one flag", () => {
    const dupPosts = [post("uri-1", "Njokuani missed weight badly"), post("uri-2", "Njokuani missed weight badly!!")];
    const raw = {
      flags: [
        { fighter: "Chidi Njokuani", category: "weight_cut", summary: "...", sourceUris: ["uri-1", "uri-2"] },
      ],
    };
    const flags = parseClusterResponse(raw, dupPosts, fighter1, fighter2);
    expect(flags[0].sources).toHaveLength(1);
  });

  it("drops an individual malformed flag but keeps the rest of the response", () => {
    const raw = {
      flags: [
        { fighter: "Chidi Njokuani", category: "weight_cut", summary: "Good flag", sourceUris: ["uri-1"] },
        { fighter: "Chidi Njokuani", category: "weight_cut" /* missing summary */, sourceUris: ["uri-2"] },
      ],
    };
    const flags = parseClusterResponse(raw, knownPosts, fighter1, fighter2);
    expect(flags).toHaveLength(1);
    expect(flags[0].summary).toBe("Good flag");
  });

  it("throws on a top-level shape that isn't { flags: [...] }", () => {
    expect(() => parseClusterResponse({ notFlags: [] }, knownPosts, fighter1, fighter2)).toThrow();
    expect(() => parseClusterResponse(null, knownPosts, fighter1, fighter2)).toThrow();
  });
});
