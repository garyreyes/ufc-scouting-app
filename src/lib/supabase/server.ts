import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireEnv } from "../requireEnv";

const supabaseUrl = requireEnv(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = requireEnv(
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
);

// For Server Components, Server Actions, and Route Handlers that need to
// know the logged-in user (RLS-scoped queries). A new client per request --
// never share this across requests. In a plain Server Component, cookies()
// can't be written, so setAll silently no-ops there; proxy.ts is what
// actually keeps the session cookie refreshed.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render -- proxy.ts handles
          // the actual refresh; safe to ignore here.
        }
      },
    },
  });
}
