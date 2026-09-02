import { describe, expect, it } from "vitest";
import { describeOwnerConfigError } from "./describeOwnerConfigError";

describe("describeOwnerConfigError", () => {
  it("recognises a missing OWNER_USER_ID", () => {
    const err = new Error(
      "Missing OWNER_USER_ID. Copy .env.local.example to .env.local and fill in values from the Supabase dashboard.",
    );
    expect(describeOwnerConfigError(err)).toContain("OWNER_USER_ID");
  });

  it("recognises a missing service-role key", () => {
    const err = new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    expect(describeOwnerConfigError(err)).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  // The one this exists to prevent: a real, unrelated bug must never be
  // silently reclassified as "just a config gap" and hidden behind a
  // friendly read-only message.
  it("does not swallow an unrelated error", () => {
    expect(describeOwnerConfigError(new Error("connection to database failed"))).toBeNull();
    expect(describeOwnerConfigError(new Error("Missing GEMINI_API_KEY"))).toBeNull();
    expect(describeOwnerConfigError(new TypeError("Cannot read properties of undefined"))).toBeNull();
  });

  it("returns null for a non-Error thrown value", () => {
    expect(describeOwnerConfigError("a string throw")).toBeNull();
    expect(describeOwnerConfigError(null)).toBeNull();
    expect(describeOwnerConfigError(undefined)).toBeNull();
  });
});
