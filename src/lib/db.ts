import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "./requireEnv";

const supabaseUrl = requireEnv(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = requireEnv(
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
);

// Plain client, no cookie-based session -- used for public reads
// (fighters/events/fights) that don't need to know who's logged in. For
// auth-aware queries, use lib/supabase/client.ts or server.ts instead.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
