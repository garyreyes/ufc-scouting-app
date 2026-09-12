import { describe, expect, it } from "vitest";
import {
  INTERN_LOCK_OFFSET_HOURS,
  USER_LOCK_OFFSET_HOURS,
  isPickLocked,
} from "./pickLockOffsets";

describe("isPickLocked", () => {
  it("is false for either author when there is no confirmed start time yet", () => {
    // Same rule check_pick_constraints() already applies: a null starts_at
    // means the card isn't confirmed yet, not locked -- there is no clock
    // to measure either author's offset against.
    const now = new Date("2026-09-01T00:00:00Z");
    expect(isPickLocked(null, "USER", now)).toBe(false);
    expect(isPickLocked(null, "INTERN", now)).toBe(false);
  });

  it(`USER is false more than ${USER_LOCK_OFFSET_HOURS}h before start`, () => {
    const startsAt = "2026-09-20T04:00:00Z";
    const now = new Date("2026-09-20T02:59:59Z"); // 1h00m01s before
    expect(isPickLocked(startsAt, "USER", now)).toBe(false);
  });

  it(`USER is true exactly at the ${USER_LOCK_OFFSET_HOURS}h boundary`, () => {
    const startsAt = "2026-09-20T04:00:00Z";
    const now = new Date("2026-09-20T03:00:00Z"); // exactly 1h before
    expect(isPickLocked(startsAt, "USER", now)).toBe(true);
  });

  it(`INTERN is false more than ${INTERN_LOCK_OFFSET_HOURS}h before start`, () => {
    const startsAt = "2026-09-20T04:00:00Z";
    const now = new Date("2026-09-19T21:59:59Z"); // 6h00m01s before
    expect(isPickLocked(startsAt, "INTERN", now)).toBe(false);
  });

  it(`INTERN is true exactly at the ${INTERN_LOCK_OFFSET_HOURS}h boundary`, () => {
    const startsAt = "2026-09-20T04:00:00Z";
    const now = new Date("2026-09-19T22:00:00Z"); // exactly 6h before
    expect(isPickLocked(startsAt, "INTERN", now)).toBe(true);
  });

  it("INTERN locks strictly earlier than USER on the same card -- the whole point of L4", () => {
    const startsAt = "2026-09-20T04:00:00Z";
    // 3h before start: inside INTERN's 6h window, outside USER's 1h window.
    const now = new Date("2026-09-20T01:00:00Z");
    expect(isPickLocked(startsAt, "INTERN", now)).toBe(true);
    expect(isPickLocked(startsAt, "USER", now)).toBe(false);
  });

  it("both are true after the card has actually started", () => {
    const startsAt = "2026-09-20T04:00:00Z";
    const now = new Date("2026-09-20T10:00:00Z");
    expect(isPickLocked(startsAt, "USER", now)).toBe(true);
    expect(isPickLocked(startsAt, "INTERN", now)).toBe(true);
  });
});
