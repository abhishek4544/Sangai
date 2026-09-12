/**
 * Provider registry for Watch Mode v1.1.
 *
 * Adding a new provider:
 *   1. Create `src/lib/watch/providers/<name>.tsx` implementing the Provider
 *      interface from ./types.ts.
 *   2. Import and push it to the PROVIDERS array below.
 *   3. Update the CSP `frame-src` allowlist in next.config.ts for the
 *      provider's embed origin (required by ADR 0006 security contract).
 *   4. Add tests to the new provider file.
 *
 * No changes to WatchPanel, useWatchSync, or the envelope are required.
 * This is AC9 — the code-shape guarantee that the day-one YouTube provider
 * does not become a prerequisite for future provider N+1.
 */

import type { Provider } from "./types";
import { youtubeProvider } from "./youtube";
import { validateWatchUrl } from "../validate-url";

/** Ordered registry. First match wins. Generic-iframe fallback (when it lands)
 *  goes last. */
export const PROVIDERS: readonly Provider[] = [youtubeProvider];

/**
 * Detect which provider (if any) can handle the given raw URL string.
 *
 * Validation flow:
 *  1. `validateWatchUrl` — rejects malformed, non-https, private-IP, blocked-host URLs.
 *     Returns ok: false | ok: true with providerId + mediaId for YouTube.
 *  2. Walk PROVIDERS in order, calling matches() on the parsed URL.
 *  3. Return the first hit with the extracted mediaId, or null.
 *
 * Returns null if:
 *  - The input is not a valid URL.
 *  - The URL is not https (or a blocked host).
 *  - No provider in the registry matches.
 *
 * Does NOT throw — callers use the null return to show "unsupported URL" copy.
 * This is a pure function with no side effects; safe to call in Vitest without
 * a browser environment.
 */
export function detectProvider(
  input: string,
): { provider: Provider; mediaId: string } | null {
  // First pass through our own validate-url.ts which also extracts YouTube IDs.
  const validated = validateWatchUrl(input);
  if (!validated.ok) return null;

  // We know it's a YouTube URL at this point (validate-url does provider detection).
  // But we still walk the PROVIDERS array to keep the registry pattern intact —
  // if validateWatchUrl is ever expanded or replaced, the registry remains the
  // authoritative dispatch table.
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  for (const provider of PROVIDERS) {
    if (provider.matches(url)) {
      const mediaId = provider.extractMediaId(url);
      if (mediaId !== null) {
        return { provider, mediaId };
      }
    }
  }

  return null;
}
