import { describe, expect, it } from "vitest";
import { collapseNearDuplicates } from "./collapseNearDuplicates";
import type { CandidatePost } from "./types";

function post(uri: string, text: string): CandidatePost {
  return { uri, authorHandle: "someone.bsky.social", text, externalUrl: null, createdAt: "2026-09-01T00:00:00Z" };
}

describe("collapseNearDuplicates", () => {
  it("collapses near-identical text to the first occurrence", () => {
    const posts = [
      post("1", "Njokuani reportedly missed weight by six pounds"),
      post("2", "Njokuani reportedly missed weight by six pounds!!"),
    ];
    const result = collapseNearDuplicates(posts);
    expect(result).toHaveLength(1);
    expect(result[0].uri).toBe("1");
  });

  it("keeps genuinely distinct posts about the same fact", () => {
    const posts = [
      post("1", "Njokuani reportedly missed weight by six pounds at this morning's official weigh-in."),
      post(
        "2",
        "A totally separate source close to camp claims Njokuani is cutting weight badly this time around, worse than any previous fight.",
      ),
    ];
    expect(collapseNearDuplicates(posts)).toHaveLength(2);
  });

  it("collapses three-way duplicates down to one", () => {
    const text = "Camp confirms short notice replacement bout, opponent pulled from the card";
    const posts = [post("1", text), post("2", text), post("3", text)];
    expect(collapseNearDuplicates(posts)).toHaveLength(1);
  });

  it("returns an empty array for an empty input", () => {
    expect(collapseNearDuplicates([])).toEqual([]);
  });
});
