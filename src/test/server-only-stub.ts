// Test-only stub for the `server-only` package. The real module throws when
// imported outside a React Server Component build (a runtime check baked into
// Next.js). Vitest runs in plain Node, so we alias `server-only` to this
// empty module (see `vitest.config.ts` → resolve.alias). Not shipped: this
// file is only referenced by the vitest config, never imported from `src/`.
export {};
