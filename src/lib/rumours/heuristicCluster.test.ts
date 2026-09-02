import { describe, expect, it } from "vitest";
import { heuristicCluster } from "./heuristicCluster";
import type { CandidatePost } from "./types";

const fighter1 = { id: "f1", name: "Chidi Njokuani" };
const fighter2 = { id: "f2", name: "Michael Page" };

function post(overrides: Partial<CandidatePost>): CandidatePost {
  return {
    uri: "at://post/1",
    authorHandle: "someone.bsky.social",
    text: "",
    externalUrl: null,
    createdAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

describe("heuristicCluster", () => {
  it("groups posts into one flag per (fighter, category)", () => {
    const posts = [
      post({ uri: "1", text: "Njokuani reportedly missed weight by six pounds" }),
      post({ uri: "2", text: "Hearing Njokuani had trouble at the weigh-in today" }),
    ];

    const flags = heuristicCluster(posts, fighter1, fighter2);

    expect(flags).toHaveLength(1);
    expect(flags[0].fighterId).toBe("f1");
    expect(flags[0].category).toBe("weight_cut");
    expect(flags[0].sources).toHaveLength(2);
  });

  // This is the actual "corroboration counts independent claims, not raw
  // post volume" rule (PRD edge case) -- the case a mutation on
  // collapseNearDuplicates must be caught by.
  it("collapses near-duplicate reposts of the same claim into one source", () => {
    const posts = [
      post({ uri: "1", text: "Njokuani reportedly missed weight by six pounds" }),
      post({ uri: "2", text: "Njokuani reportedly missed weight by six pounds!!" }),
    ];

    const flags = heuristicCluster(posts, fighter1, fighter2);

    expect(flags).toHaveLength(1);
    expect(flags[0].sources).toHaveLength(1);
  });

  it("does not collapse two genuinely different posts about the same concern", () => {
    const posts = [
      post({
        uri: "1",
        text: "Njokuani reportedly missed weight by six pounds at this morning's official weigh-in.",
      }),
      post({
        uri: "2",
        text: "A totally separate source close to camp claims Njokuani is cutting weight badly this time around, worse than any previous fight.",
      }),
    ];

    const flags = heuristicCluster(posts, fighter1, fighter2);

    expect(flags[0].sources).toHaveLength(2);
  });

  it("drops a post with no keyword match -- no flag invented for plain chatter", () => {
    const posts = [post({ uri: "1", text: "Njokuani looked sharp in this morning's open workout" })];
    expect(heuristicCluster(posts, fighter1, fighter2)).toHaveLength(0);
  });

  it("drops a post that can't be attributed to either fighter", () => {
    const posts = [post({ uri: "1", text: "Someone missed weight today apparently" })];
    expect(heuristicCluster(posts, fighter1, fighter2)).toHaveLength(0);
  });

  it("drops a post naming both fighters rather than guessing which one", () => {
    const posts = [post({ uri: "1", text: "Njokuani vs Page: Page reportedly injured in camp" })];
    // Both names appear -- findFighterMentionInText already covers this,
    // this just confirms the pipeline doesn't accidentally re-resolve it.
    expect(heuristicCluster(posts, fighter1, fighter2)).toHaveLength(0);
  });

  it("keeps weight_cut and injury as separate flags for the same fighter", () => {
    const posts = [
      post({ uri: "1", text: "Njokuani missed weight this morning" }),
      post({ uri: "2", text: "Also hearing Njokuani is dealing with an injury from camp" }),
    ];

    const flags = heuristicCluster(posts, fighter1, fighter2);

    expect(flags).toHaveLength(2);
    expect(flags.map((f) => f.category).sort()).toEqual(["injury", "weight_cut"]);
  });

  it("never produces an 'other' flag -- keyword matching alone can't justify it", () => {
    const posts = [post({ uri: "1", text: "Njokuani facing a lawsuit ahead of the fight" })];
    expect(heuristicCluster(posts, fighter1, fighter2)).toHaveLength(0);
  });
});
