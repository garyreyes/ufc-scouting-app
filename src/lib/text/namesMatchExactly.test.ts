import { describe, expect, it } from "vitest";
import { namesMatchExactly } from "./namesMatchExactly";

describe("namesMatchExactly", () => {
  it("matches an identical name", () => {
    expect(namesMatchExactly("Dan Hooker", "Dan Hooker")).toBe(true);
  });

  it("matches regardless of case", () => {
    expect(namesMatchExactly("dan hooker", "DAN HOOKER")).toBe(true);
  });

  // The real production case (I2b, 2026-09-03): upsertFighter.ts's old
  // exact-match fallback (a plain `ilike`) never folded diacritics, so
  // Wikipedia's "André Lima" and API-Sports' "Andre Lima" were never
  // recognized as the same person -- two separate rows, one of them
  // stuck retrying forever against enrichFighters.ts (the external_id
  // the other row already holds).
  it("matches names differing only by diacritics", () => {
    expect(namesMatchExactly("André Lima", "Andre Lima")).toBe(true);
  });

  it("tolerates extra or leading/trailing whitespace", () => {
    expect(namesMatchExactly("  Dan   Hooker  ", "Dan Hooker")).toBe(true);
  });

  // The deliberate line this function must NOT cross: this is an EXACT
  // match after normalizing, never a fuzzy one. upsertFighter.ts's own
  // matching must stay conservative -- a false-positive merge here
  // silently attaches one real fighter's synced data to a genuinely
  // different person, which nothing downstream would ever catch.
  it("does not match two genuinely different names, even similar ones", () => {
    expect(namesMatchExactly("Jon Jones", "John Jones")).toBe(false);
    expect(namesMatchExactly("Israel Adesanya", "Israel Adekunle")).toBe(false);
  });

  it("does not match a name that is merely a substring of the other", () => {
    expect(namesMatchExactly("Dan Hooker", "Dan Hooker Jr")).toBe(false);
  });
});
