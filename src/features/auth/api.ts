import { createClient } from "@/lib/supabase/client";

export type OAuthProvider = "google" | "github";

export async function signInWithOAuth(provider: OAuthProvider) {
  const supabase = createClient();
  await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  });
}

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
}
