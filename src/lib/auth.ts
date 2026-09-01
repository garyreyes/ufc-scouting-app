import { requireEnv } from "./requireEnv";

// The single wrapper module for the owner-allowlist check, per
// CLAUDE.md's hard-halts (one wrapper per concern, feature code imports
// this rather than comparing ids inline).
//
// For any table a client writes to directly (picks, clans, ...), this is
// UX convenience ONLY -- the real boundary is the `is_owner()` Postgres
// function and the restrictive RLS policies in
// supabase/migrations/0017_owner_allowlist.sql, which enforce this
// independently of anything this file does or any bug in it.
//
// Exception: features/job-health/actions.ts's retryOddsJobAction, which
// runs through the service-role admin client because odds_snapshots and
// job_runs have no client write grant at all for RLS to gate. There, this
// check IS the real security boundary -- see that file's docstring.
// Tested (src/lib/auth.test.ts) precisely because of that second role.
export function isOwner(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const ownerId = requireEnv(process.env.OWNER_USER_ID, "OWNER_USER_ID");
  return userId === ownerId;
}
