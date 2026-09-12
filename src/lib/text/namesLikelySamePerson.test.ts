import { describe, expect, it } from "vitest";
import { namesLikelySamePerson } from "./namesLikelySamePerson";

// L2b: backs upsertFighter's unattended fold-merge, so a false positive
// silently welds two fighters' careers together. Every "true" here is a
// real production duplicate the L2 refresh exposed; every "false" is a
// pair that must stay separate.

describe("namesLikelySamePerson", () => {
  it("matches an exact name", () => {
    expect(namesLikelySamePerson("Dan Hooker", "Dan Hooker")).toBe(true);
  });

  it("matches across case, diacritics and whitespace runs (namesMatchExactly's job)", () => {
    expect(namesLikelySamePerson("André Lima", "andre  lima")).toBe(true);
  });

  it("matches a missing internal space", () => {
    expect(namesLikelySamePerson("Sumudaerji", "Su Mudaerji")).toBe(true);
    expect(namesLikelySamePerson("Aoriqileng", "Aori Qileng")).toBe(true);
  });

  it("matches a name-order swap", () => {
    expect(namesLikelySamePerson("Ce Liu", "Liu Ce")).toBe(true);
    expect(namesLikelySamePerson("Xiong Jingnan", "Jingnan Xiong")).toBe(true);
  });

  it("matches a diacritic difference on its own (namesMatchExactly's case, not a swap)", () => {
    expect(namesLikelySamePerson("Marcio Barbosa", "Márcio Barbosa")).toBe(true);
  });

  it("matches a name-order swap combined with a diacritic", () => {
    expect(namesLikelySamePerson("Marcio Barbosa", "Barbosa Márcio")).toBe(true);
  });

  it("does NOT match a nickname / short form", () => {
    expect(namesLikelySamePerson("Wes Schultz", "Wesley Schultz")).toBe(false);
    expect(namesLikelySamePerson("Stan Dorsainvil", "Stanley Dorsainvil")).toBe(false);
  });

  it("does NOT match a suffix difference", () => {
    expect(namesLikelySamePerson("Dan Hooker", "Dan Hooker Jr")).toBe(false);
    expect(namesLikelySamePerson("Levi Rodrigues", "Levi Rodrigues Jr.")).toBe(false);
  });

  it("does NOT match two genuinely different people", () => {
    expect(namesLikelySamePerson("Jon Jones", "John Jones")).toBe(false);
    expect(namesLikelySamePerson("Bruno Silva", "Bruno Souza")).toBe(false);
    expect(namesLikelySamePerson("Alex Pereira", "Alex Perez")).toBe(false);
  });

  it("does NOT treat a single-token name as reorderable", () => {
    expect(namesLikelySamePerson("Aoriqileng", "Qilengaori")).toBe(false);
  });

  it("does NOT match when one name has an extra token even if the rest reorders", () => {
    expect(namesLikelySamePerson("Song Yadong", "Yadong Song Jr")).toBe(false);
  });
});
