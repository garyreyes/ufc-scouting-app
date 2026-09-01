import { createClient } from "@supabase/supabase-js";

// Moved here from lib/ufc-data-sync/supabaseAdmin.ts (2026-09-01): it was
// never sync-specific, and lib/odds/ needs the same service-role client.
// One wrapper module, shared by every feature that needs it -- matches the
// security-baseline rule that a third-party SDK gets exactly one wrapper,
// not one per feature that happens to need it.
export function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  // service role bypasses RLS -- this must only ever run server-side.
  return createClient(url, serviceRoleKey);
}
