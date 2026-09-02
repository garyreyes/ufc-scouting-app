import { describe, expect, it } from "vitest";
import { findFighterMentionInText, resolveFighterMention } from "./matchFighterMention";

const fighter1 = { id: "f1", name: "Chidi Njokuani" };
const fighter2 = { id: "f2", name: "Michael Page" };

describe("resolveFighterMention", () => {
  it("matches an exact name to the right fighter", () => {
    expect(resolveFighterMention("Chidi Njokuani", fighter1, fighter2)).toEqual(fighter1);
    expect(resolveFighterMention("Michael Page", fighter1, fighter2)).toEqual(fighter2);
  });

  it("tolerates minor rephrasing", () => {
    expect(resolveFighterMention("Chidi Njokuani Jr", fighter1, fighter2)).toEqual(fighter1);
  });

  it("returns null for a name matching neither fighter", () => {
    expect(resolveFighterMention("Jon Jones", fighter1, fighter2)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(resolveFighterMention("", fighter1, fighter2)).toBeNull();
  });

  it("returns null on an exact tie rather than guessing", () => {
    const same = { id: "f3", name: "Chidi Njokuani" };
    // Both "candidates" are the same name -- score1 === score2 by construction.
    expect(resolveFighterMention("Chidi Njokuani", same, { ...same, id: "f4" })).toBeNull();
  });
});

describe("findFighterMentionInText", () => {
  it("attributes a post naming only one fighter's last name", () => {
    expect(
      findFighterMentionInText("Njokuani reportedly missed weight by six pounds", fighter1, fighter2),
    ).toEqual(fighter1);
    expect(findFighterMentionInText("Page is out with a hand injury", fighter1, fighter2)).toEqual(
      fighter2,
    );
  });

  it("drops a post that names both fighters -- ambiguous, not guessed", () => {
    expect(
      findFighterMentionInText("Njokuani vs Page card update: no changes reported", fighter1, fighter2),
    ).toBeNull();
  });

  it("drops a post mentioning neither fighter", () => {
    expect(findFighterMentionInText("Jon Jones talks retirement", fighter1, fighter2)).toBeNull();
  });

  it("is not fooled by an unrelated word that happens to share some letters", () => {
    // "Rage" shares two of Page's three bigrams (ag, ge) but is a
    // genuinely different word -- exercises the threshold, not just
    // presence/absence.
    expect(findFighterMentionInText("Local promotion Rage FC announces new signing", fighter1, fighter2)).toBeNull();
  });
});
