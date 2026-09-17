import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Next resolves tsconfig.json's "@/*" -> "./src/*" natively (webpack/
// Turbopack); vitest does not read tsconfig paths on its own. Every test
// so far happened to only import relative paths, so this gap was latent
// until features/conflicts/resolveDisputedOpponent.ts became the first
// module a test transitively pulls in that imports via "@/" -- found by
// running the new test, not by inspection.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // M1: features/fighters/api.ts (and other lib/db.ts importers) build
    // the Supabase client at module scope, so importing them in a test
    // throws requireEnv's error before any test body runs -- even though
    // every test injects its own fake client and never touches the real
    // one. Dummy values only; createClient never makes a network call at
    // construction time, so no real Supabase project is contacted.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://test-project.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
    },
  },
});
