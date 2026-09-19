import { describe, expect, it } from "vitest";
import { isLockedError } from "./generateInternPicks";

describe("isLockedError", () => {
  // L4-fix's exact real-world shape: this codebase never calls
  // `.throwOnError()`, so a failed Supabase `.upsert()` throws PostgREST's
  // own plain object, never a real `Error` instance. `err instanceof
  // Error` is false for this shape -- the whole reason the original
  // check never once caught a real lock rejection.
  it("recognizes a lock rejection from a plain PostgREST-shaped error object", () => {
    // Exact trigger text from 0041_author_aware_pick_lock.sql's own
    // `raise exception`.
    const postgrestError = {
      message: "Picks are locked: INTERN picks lock 6h before the card starts",
      code: "P0001",
      details: null,
      hint: null,
    };
    expect(isLockedError(postgrestError)).toBe(true);
  });

  it("does not flag a plain-object error unrelated to the lock", () => {
    const postgrestError = { message: "duplicate key value violates unique constraint", code: "23505" };
    expect(isLockedError(postgrestError)).toBe(false);
  });

  it("still recognizes a real Error instance carrying the lock message", () => {
    expect(isLockedError(new Error("Picks are locked for this fight."))).toBe(true);
  });

  it("does not throw on non-object error values, falling back to String(err)", () => {
    expect(isLockedError("Picks are locked")).toBe(true); // a bare string is stringified as-is
    expect(isLockedError(null)).toBe(false);
    expect(isLockedError(undefined)).toBe(false);
  });

  it("does not throw on an object with no message property", () => {
    expect(isLockedError({ code: "23505" })).toBe(false);
  });
});
