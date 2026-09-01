import { afterEach, describe, expect, it, vi } from "vitest";
import { isOwner } from "./auth";

// isOwner() started as UX-only (its own docstring says so), backed by RLS
// for every write it gated. B5's retryOddsJobAction is the first caller
// where that's no longer true -- odds_snapshots/job_runs have no
// INSERT grant for anon/authenticated at all, so this check, run against
// the real session server-side, is now the actual security boundary for
// that one action. Worth a real test now that a bug here is exploitable,
// not just a UX glitch.
describe("isOwner", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is true only for the exact configured owner id", () => {
    vi.stubEnv("OWNER_USER_ID", "owner-uuid");
    expect(isOwner("owner-uuid")).toBe(true);
  });

  it("is false for any other real user id", () => {
    vi.stubEnv("OWNER_USER_ID", "owner-uuid");
    expect(isOwner("some-stranger-uuid")).toBe(false);
  });

  it("is false for a logged-out user (null/undefined), never defaulting to true", () => {
    vi.stubEnv("OWNER_USER_ID", "owner-uuid");
    expect(isOwner(null)).toBe(false);
    expect(isOwner(undefined)).toBe(false);
  });

  it("is false for an empty string id rather than false-matching an unset comparison", () => {
    vi.stubEnv("OWNER_USER_ID", "owner-uuid");
    expect(isOwner("")).toBe(false);
  });
});
