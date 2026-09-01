import { describe, expect, it } from "vitest";
import { isPastSnapshotWindow, SNAPSHOT_LEAD_HOURS } from "./snapshotWindow";

describe("isPastSnapshotWindow", () => {
  it("is false when there is no confirmed start time yet", () => {
    // No starts_at means B4 hasn't found a confident match -- there is
    // nothing to be "past the window" of. Must never be treated as
    // eligible, since that would snapshot against an unknown, possibly
    // wrong, event.
    expect(isPastSnapshotWindow(null, new Date("2026-09-01T00:00:00Z"))).toBe(false);
  });

  it(`is false more than ${SNAPSHOT_LEAD_HOURS}h before the confirmed start`, () => {
    const startsAt = "2026-09-20T04:00:00Z";
    const now = new Date("2026-09-19T15:59:59Z"); // 12h00m01s before
    expect(isPastSnapshotWindow(startsAt, now)).toBe(false);
  });

  it(`is true exactly at the ${SNAPSHOT_LEAD_HOURS}h boundary`, () => {
    const startsAt = "2026-09-20T04:00:00Z";
    const now = new Date("2026-09-19T16:00:00Z"); // exactly 12h before
    expect(isPastSnapshotWindow(startsAt, now)).toBe(true);
  });

  it("is true after the confirmed start time has already passed", () => {
    const startsAt = "2026-09-20T04:00:00Z";
    const now = new Date("2026-09-20T10:00:00Z");
    expect(isPastSnapshotWindow(startsAt, now)).toBe(true);
  });
});
