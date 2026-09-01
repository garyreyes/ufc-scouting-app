import { requireEnv } from "./requireEnv";

// The single wrapper module for the owner-allowlist check, per
// CLAUDE.md's hard-halts (one wrapper per concern, feature code imports
// this rather than comparing ids inline).
//
// This is a UX convenience ONLY -- deciding what to render (a sign-in
// prompt vs. "not available" vs. the real UI). It carries no security
// weight of its own: the actual boundary is the `is_owner()` Postgres
// function and the restrictive RLS policies in
// supabase/migrations/0017_owner_allowlist.sql, which enforce this
// independently of anything this file does or any bug in it. Never trust
// this function's result as the reason a write is safe -- the database
// enforces that regardless.
export function isOwner(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const ownerId = requireEnv(process.env.OWNER_USER_ID, "OWNER_USER_ID");
  return userId === ownerId;
}
