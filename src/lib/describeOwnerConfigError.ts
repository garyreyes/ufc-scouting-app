// Recognizes the two specific requireEnv() failures behind the
// 2026-09-02 production outage: OWNER_USER_ID (lib/auth.ts's isOwner)
// and SUPABASE_SERVICE_ROLE_KEY (lib/supabase/admin.ts's
// getSupabaseAdmin), both reachable from an owner-gated page render, not
// just a job or a Server Action.
//
// Deliberately narrow pattern matching, not "any thrown error while
// checking ownership": swallowing an UNRECOGNIZED error here would hide
// a real bug behind a friendly "read-only for now" message, which is the
// opposite of this project's fail-loudly rule. Returning null tells the
// caller to rethrow rather than degrade.
export function describeOwnerConfigError(err: unknown): string | null {
  if (!(err instanceof Error)) return null;

  if (err.message.startsWith("Missing OWNER_USER_ID")) {
    return "Owner isn't configured on this deployment (OWNER_USER_ID is missing) — showing the read-only view until this is fixed.";
  }

  if (err.message.startsWith("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")) {
    return "The server's admin connection isn't configured (SUPABASE_SERVICE_ROLE_KEY is missing) — showing the read-only view until this is fixed.";
  }

  return null;
}
