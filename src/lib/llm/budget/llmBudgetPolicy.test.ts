import { describe, expect, it } from "vitest";
import {
  isPastMinInterval,
  isWithinDailyCap,
  isWithinSurfaceSoftCap,
  SURFACE_SOFT_CAPS,
} from "./llmBudgetPolicy";
import { DAILY_CALL_CAP, MIN_CALL_INTERVAL_MS } from "../models";

describe("isWithinSurfaceSoftCap", () => {
  it("allows a surface under its configured cap", () => {
    expect(isWithinSurfaceSoftCap("rumours", 0)).toBe(true);
    expect(isWithinSurfaceSoftCap("rumours", SURFACE_SOFT_CAPS.rumours - 1)).toBe(true);
  });

  it("denies a surface exactly at its cap -- the cap is exclusive, not inclusive", () => {
    expect(isWithinSurfaceSoftCap("rumours", SURFACE_SOFT_CAPS.rumours)).toBe(false);
  });

  it("denies a surface over its cap", () => {
    expect(isWithinSurfaceSoftCap("rumours", SURFACE_SOFT_CAPS.rumours + 50)).toBe(false);
  });

  it("allows an unconfigured surface -- no soft cap is not a reason to deny", () => {
    expect(isWithinSurfaceSoftCap("manual", 10_000)).toBe(true);
  });

  // The three configured surfaces must sum to less than the daily cap --
  // the gap is deliberate headroom for workflow_dispatch re-runs and
  // backfills (Phase N plan, "Budget" section). A future edit that
  // silently raises one surface's cap past that headroom should fail this
  // test, not be discovered live.
  it("keeps the configured surface caps summing to less than the daily cap", () => {
    const total = Object.values(SURFACE_SOFT_CAPS).reduce((sum, cap) => sum + cap, 0);
    expect(total).toBeLessThan(DAILY_CALL_CAP);
  });
});

describe("isPastMinInterval", () => {
  it("allows the first call ever (no prior call recorded)", () => {
    expect(isPastMinInterval(null, new Date())).toBe(true);
  });

  it("denies a call inside the minimum interval", () => {
    const lastCall = new Date("2026-09-18T00:00:00.000Z");
    const now = new Date(lastCall.getTime() + MIN_CALL_INTERVAL_MS - 1);
    expect(isPastMinInterval(lastCall, now)).toBe(false);
  });

  it("allows a call exactly at the minimum interval", () => {
    const lastCall = new Date("2026-09-18T00:00:00.000Z");
    const now = new Date(lastCall.getTime() + MIN_CALL_INTERVAL_MS);
    expect(isPastMinInterval(lastCall, now)).toBe(true);
  });

  it("allows a call well past the minimum interval", () => {
    const lastCall = new Date("2026-09-18T00:00:00.000Z");
    const now = new Date(lastCall.getTime() + MIN_CALL_INTERVAL_MS * 10);
    expect(isPastMinInterval(lastCall, now)).toBe(true);
  });

  it("accepts a custom interval override -- used by tests exercising other values, not production", () => {
    const lastCall = new Date("2026-09-18T00:00:00.000Z");
    const now = new Date(lastCall.getTime() + 999);
    expect(isPastMinInterval(lastCall, now, 1000)).toBe(false);
    expect(isPastMinInterval(lastCall, now, 999)).toBe(true);
  });
});

describe("isWithinDailyCap", () => {
  it("allows under the cap", () => {
    expect(isWithinDailyCap(0)).toBe(true);
    expect(isWithinDailyCap(DAILY_CALL_CAP - 1)).toBe(true);
  });

  it("denies exactly at the cap -- exclusive, matching the SQL function's >= check", () => {
    expect(isWithinDailyCap(DAILY_CALL_CAP)).toBe(false);
  });

  it("denies over the cap", () => {
    expect(isWithinDailyCap(DAILY_CALL_CAP + 100)).toBe(false);
  });

  it("accepts a custom cap override", () => {
    expect(isWithinDailyCap(5, 5)).toBe(false);
    expect(isWithinDailyCap(4, 5)).toBe(true);
  });
});
