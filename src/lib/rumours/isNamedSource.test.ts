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

  it("does not false-match a handle that merely contains the bridge domain as a substring", () => {
    expect(isNamedSource("web.brid.gy.fake.bsky.social")).toBe(false);
  });
});
