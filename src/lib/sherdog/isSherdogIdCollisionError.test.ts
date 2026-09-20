import { describe, expect, it } from "vitest";
import { isSherdogIdCollisionError } from "./isSherdogIdCollisionError";

// P6 (ROADMAP_V2.md): this codebase never calls .throwOnError() on a
// Supabase query, so a failed write throws PostgREST's own plain
// {message, code, details, hint} object, never a real Error instance --
// see generateInternPicks.ts's isLockedError for the same fix, same
// underlying reason. Real message captured live, 2026-09-18
// (0046_merge_fighters_unique_collision.sql's own header).
describe("isSherdogIdCollisionError", () => {
  it("recognizes the real fighters_sherdog_id_key unique violation shape", () => {
    const err = {
      message: 'duplicate key value violates unique constraint "fighters_sherdog_id_key"',
      code: "23505",
      details: "Key (sherdog_id)=(307733) already exists.",
      hint: null,
    };
    expect(isSherdogIdCollisionError(err)).toBe(true);
  });

  it("does not match a different unique constraint's 23505 (e.g. external_id)", () => {
    const err = {
      message: 'duplicate key value violates unique constraint "fighters_external_id_key"',
      code: "23505",
    };
    expect(isSherdogIdCollisionError(err)).toBe(false);
  });

  it("does not match a non-23505 error even if it mentions sherdog_id", () => {
    const err = { message: "some other error about sherdog_id", code: "42601" };
    expect(isSherdogIdCollisionError(err)).toBe(false);
  });

  it("does not match a real Error instance without the constraint name", () => {
    expect(isSherdogIdCollisionError(new Error("network timeout"))).toBe(false);
  });

  it("does not throw on a non-object value", () => {
    expect(isSherdogIdCollisionError(null)).toBe(false);
    expect(isSherdogIdCollisionError(undefined)).toBe(false);
    expect(isSherdogIdCollisionError("plain string")).toBe(false);
  });
});
