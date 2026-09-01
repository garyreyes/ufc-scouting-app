import { describe, expect, it } from "vitest";
import { buildOddsUrl } from "./client";

// Regression test for a real bug that shipped in B3 and was only caught
// live in B4 (CHANGES.md), the first time fetchMmaOdds() was actually
// invoked end-to-end: `new URL(path, base)` treats a leading "/" in path
// as absolute-from-origin, silently dropping BASE_URL's own "/v4" instead
// of appending to it. Neither B1's curl checks nor B3's pure-function
// tests ever exercised this code path -- this is why the URL construction
// itself now gets a test, not just the parsing/matching logic downstream
// of it.
describe("buildOddsUrl", () => {
  it("includes the /v4 API version prefix", () => {
    const url = buildOddsUrl("test-key");
    expect(url.pathname).toBe("/v4/sports/mma_mixed_martial_arts/odds");
  });

  it("targets the correct host", () => {
    const url = buildOddsUrl("test-key");
    expect(url.hostname).toBe("api.the-odds-api.com");
  });

  it("includes the api key and every required query param", () => {
    const url = buildOddsUrl("my-secret-key");
    expect(url.searchParams.get("apiKey")).toBe("my-secret-key");
    expect(url.searchParams.get("regions")).toBe("us");
    expect(url.searchParams.get("markets")).toBe("h2h");
    expect(url.searchParams.get("oddsFormat")).toBe("decimal");
    expect(url.searchParams.get("bookmakers")).toBe("betonlineag");
  });
});
