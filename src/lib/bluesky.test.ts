import { afterEach, describe, expect, it, vi } from "vitest";
import { decideAuthAction } from "./bluesky";

// Regression coverage for the two-day rumour-job outage (CHANGES.md Phase
// 56): Bluesky rate-limits com.atproto.server.createSession to 30/5min and
// 300/day per account, and the scan job -- ~14 fights, two concurrent
// searchMmaPosts each -- was re-authenticating on every cold-cache call,
// ~28 createSession attempts per run, then retrying per fight after each
// 429 so the account never came back under its cap. These tests pin the
// fix: at most one createSession attempt per run, success or failure.

describe("decideAuthAction", () => {
  const base = { session: null, authFailedUntilMs: 0, hasPendingAuth: false, now: 1_000_000 };

  it("uses a still-valid cached session ahead of everything else", () => {
    expect(decideAuthAction({ ...base, session: { expiresAtMs: base.now + 1 } })).toBe("use-cache");
  });

  it("prefers a valid cache even while a failure cooldown is active", () => {
    expect(
      decideAuthAction({
        ...base,
        session: { expiresAtMs: base.now + 1 },
        authFailedUntilMs: base.now + 10_000,
      }),
    ).toBe("use-cache");
  });

  it("treats a session expiring exactly now as expired (strict comparison)", () => {
    expect(decideAuthAction({ ...base, session: { expiresAtMs: base.now } })).not.toBe("use-cache");
  });

  it("reports a cooldown when a recent auth failure has not yet aged out", () => {
    expect(decideAuthAction({ ...base, authFailedUntilMs: base.now + 1 })).toBe("in-cooldown");
  });

  it("lets the cooldown win over joining an in-flight attempt", () => {
    expect(
      decideAuthAction({ ...base, authFailedUntilMs: base.now + 1, hasPendingAuth: true }),
    ).toBe("in-cooldown");
  });

  it("joins an in-flight attempt when the cache is cold and no cooldown applies", () => {
    expect(decideAuthAction({ ...base, hasPendingAuth: true })).toBe("await-pending");
  });

  it("authenticates fresh with no cache, no cooldown, nothing in flight", () => {
    expect(decideAuthAction(base)).toBe("authenticate");
  });

  it("authenticates again once the cooldown has aged out", () => {
    expect(decideAuthAction({ ...base, authFailedUntilMs: base.now - 1 })).toBe("authenticate");
  });
});

describe("searchMmaPosts — createSession is attempted at most once per run", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  // bluesky.ts holds the session cache / cooldown in module state, so each
  // scenario needs a fresh copy of the module.
  async function loadFresh() {
    vi.resetModules();
    return import("./bluesky");
  }

  function stubCredentials() {
    vi.stubEnv("BLUESKY_IDENTIFIER", "test.bsky.social");
    vi.stubEnv("BLUESKY_APP_PASSWORD", "test-app-password");
  }

  it("makes one createSession call for many concurrent searches, then fails them all with BlueskyAuthError", async () => {
    stubCredentials();
    let createSessionCalls = 0;
    let searchCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        if (String(input).includes("com.atproto.server.createSession")) {
          createSessionCalls++;
          return new Response(JSON.stringify({ error: "RateLimitExceeded" }), { status: 429 });
        }
        searchCalls++;
        return new Response(JSON.stringify({ posts: [] }), { status: 200 });
      }),
    );

    const { searchMmaPosts, BlueskyAuthError } = await loadFresh();

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => searchMmaPosts(`fighter ${i}`)),
    );

    expect(createSessionCalls).toBe(1);
    expect(searchCalls).toBe(0);
    expect(results.map((r) => r.status)).toEqual(Array.from({ length: 10 }, () => "rejected"));
    for (const r of results) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(BlueskyAuthError);
    }
  });

  it("does not hit createSession again on a later call still inside the failure cooldown", async () => {
    stubCredentials();
    let createSessionCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        if (String(input).includes("com.atproto.server.createSession")) {
          createSessionCalls++;
          return new Response("rate limited", { status: 429 });
        }
        return new Response(JSON.stringify({ posts: [] }), { status: 200 });
      }),
    );

    const { searchMmaPosts, BlueskyAuthError } = await loadFresh();

    await expect(searchMmaPosts("first")).rejects.toBeInstanceOf(BlueskyAuthError);
    await expect(searchMmaPosts("second")).rejects.toBeInstanceOf(BlueskyAuthError);

    expect(createSessionCalls).toBe(1);
  });

  it("authenticates once and reuses the session across concurrent searches on the happy path", async () => {
    stubCredentials();
    let createSessionCalls = 0;
    let searchCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        if (String(input).includes("com.atproto.server.createSession")) {
          createSessionCalls++;
          return new Response(JSON.stringify({ accessJwt: "test-jwt" }), { status: 200 });
        }
        searchCalls++;
        return new Response(JSON.stringify({ posts: [] }), { status: 200 });
      }),
    );

    const { searchMmaPosts } = await loadFresh();

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => searchMmaPosts(`fighter ${i}`)),
    );

    expect(createSessionCalls).toBe(1);
    expect(searchCalls).toBe(10);
    expect(results).toEqual(Array.from({ length: 10 }, () => []));
  });

  it("rejects a 200 createSession response that carries no accessJwt instead of caching a dead session", async () => {
    stubCredentials();
    let createSessionCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        if (String(input).includes("com.atproto.server.createSession")) {
          createSessionCalls++;
          return new Response(JSON.stringify({}), { status: 200 });
        }
        return new Response(JSON.stringify({ posts: [] }), { status: 200 });
      }),
    );

    const { searchMmaPosts, BlueskyAuthError } = await loadFresh();

    await expect(searchMmaPosts("x")).rejects.toBeInstanceOf(BlueskyAuthError);
    expect(createSessionCalls).toBe(1);
  });
});
