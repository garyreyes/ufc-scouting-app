import { createClient } from "@/lib/supabase/client";

export type OAuthProvider = "google" | "github";

// `next` lets a caller (e.g. an invite link) return the user to the same
// page they were on -- e.g. /clans/callback picks it back up from the
// query string after the OAuth round trip.
export async function signInWithOAuth(provider: OAuthProvider, next?: string) {
  const supabase = createClient();
  const redirectTo = new URL("/auth/callback", window.location.origin);
  if (next) redirectTo.searchParams.set("next", next);

  await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: redirectTo.toString() },
  });
}

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
}
