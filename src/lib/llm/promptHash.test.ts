import { describe, expect, it } from "vitest";
import { hashCanonicalJson } from "./promptHash";

describe("hashCanonicalJson", () => {
  it("is deterministic for the same value", () => {
    const value = { a: 1, b: [1, 2, 3] };
    expect(hashCanonicalJson(value)).toBe(hashCanonicalJson(value));
  });

  // The whole reason this exists rather than plain JSON.stringify: two
  // call sites building an otherwise-identical fighter bundle in a
  // different field order must hash identically, or N7's cache would
  // register a spurious miss that looks like the fighter's data changed.
  it("is insensitive to object key order", () => {
    const a = { fighterId: "f1", eloRating: 1500, reachCm: 190 };
    const b = { reachCm: 190, fighterId: "f1", eloRating: 1500 };
    expect(hashCanonicalJson(a)).toBe(hashCanonicalJson(b));
  });

  it("is insensitive to key order in nested objects", () => {
    const a = { fighter: { name: "A", stats: { wins: 1, losses: 0 } } };
    const b = { fighter: { stats: { losses: 0, wins: 1 }, name: "A" } };
    expect(hashCanonicalJson(a)).toBe(hashCanonicalJson(b));
  });

  it("does NOT reorder array elements -- order is real signal there", () => {
    const a = { flags: ["injury", "weight_cut"] };
    const b = { flags: ["weight_cut", "injury"] };
    expect(hashCanonicalJson(a)).not.toBe(hashCanonicalJson(b));
  });

  it("distinguishes a genuinely different value", () => {
    expect(hashCanonicalJson({ a: 1 })).not.toBe(hashCanonicalJson({ a: 2 }));
  });

  it("hashes a plain string (the actual prompt-hash use case in logLlmCall.ts)", () => {
    expect(hashCanonicalJson("hello")).toBe(hashCanonicalJson("hello"));
    expect(hashCanonicalJson("hello")).not.toBe(hashCanonicalJson("world"));
  });
});
