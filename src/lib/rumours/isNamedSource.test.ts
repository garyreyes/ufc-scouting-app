import { describe, expect, it } from "vitest";
import { isNamedSource } from "./isNamedSource";

describe("isNamedSource", () => {
  it("recognises a bridged outlet account", () => {
    expect(isNamedSource("bloodyelbow.com.web.brid.gy")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isNamedSource("BloodyElbow.com.web.brid.gy")).toBe(true);
  });

  it("returns false for an ordinary fan account", () => {
    expect(isNamedSource("randomfan123.bsky.social")).toBe(false);
  });

  // Real, live-confirmed case (F3, 2026-09-02): Bloody Elbow posts under
  // this native handle in addition to their separate .web.brid.gy mirror
  // -- found by running getRumourFlagsForFight against real production
  // data and seeing a real named outlet's post marked isNamedSource:
  // false, not assumed or guessed.
  it("recognises a hand-maintained allowlist entry for a native (non-bridged) outlet handle", () => {
    expect(isNamedSource("bloodyelbow.com")).toBe(true);
  });

  it("does not false-match a handle that merely contains the bridge domain as a substring", () => {
    expect(isNamedSource("web.brid.gy.fake.bsky.social")).toBe(false);
  });
});
