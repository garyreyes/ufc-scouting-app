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
});
