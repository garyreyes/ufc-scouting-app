import { createBrowserClient } from "@supabase/ssr";
import { requireEnv } from "../requireEnv";

const supabaseUrl = requireEnv(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = requireEnv(
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
);

// Cookie-based session (not localStorage), so server components/middleware
// can see who's logged in too. Only needed for auth flows -- public reads
// (fighters/events/fights) still go through the plain client in lib/db.ts.
export function createClient() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
