import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Mirror the tsconfig "@/*" path so tests that import server modules
      // (e.g. src/lib/livekit/token.ts → @/lib/env) can resolve the same way
      // the Next.js build does.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws at import time in a client context — which vitest
      // is, from its perspective. Stub it to a no-op module so we can unit-test
      // server-only helpers (env-gated JWT mint, RoomService wrapper) without
      // needing a Next.js server-component build.
      "server-only": fileURLToPath(
        new URL("./src/test/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text"],
      include: ["src/lib/hidden-gem.ts"],
      thresholds: {
        lines: 90,
        functions: 100,
        branches: 85,
      },
    },
  },
});
