/**
 * Provider interface for Watch Mode v1.1.
 *
 * Every provider file under `src/lib/watch/providers/` exports a `Provider`
 * value that conforms to this interface. The registry is the single extension
 * surface: adding a new provider = one new file + one entry in `PROVIDERS`.
 * No changes to `WatchPanel`, `useWatchSync`, or the envelope are required.
 * This is AC9 (provider registry pattern).
 *
 * Security note (M1): The sandbox posture on the iframe is per-provider
 * auditable. YouTube uses "allow-scripts allow-same-origin allow-presentation".
 * A future generic-iframe fallback MUST NOT inherit "allow-same-origin" without
 * explicit justification — it effectively removes the sandbox for that origin.
 */

import type React from "react";

export type PlayerEvent =
  | { type: "ready" }
  | { type: "play"; positionSec: number }
  | { type: "pause"; positionSec: number }
  | { type: "seek"; positionSec: number }
  | { type: "error"; code: "embed_refused" | "unknown" };

export interface ProviderPlayerHandle {
  play(): void;
  pause(): void;
  seekTo(positionSec: number): void;
  getPositionSec(): number;
}

export interface ProviderPlayerProps {
  mediaId: string;
  onEvent: (event: PlayerEvent) => void;
  handleRef: React.RefObject<ProviderPlayerHandle | null>;
}

export interface Provider {
  /** Stable identifier — used in watch/load payloads. Widen union when adding providers. */
  id: "youtube";
  /** Return true if this provider can handle the given URL. */
  matches(url: URL): boolean;
  /**
   * Extract the canonical media ID from a URL.
   * Strips all source-URL query params — only the ID is forwarded.
   * This is the M5 remediation: callers construct the embed URL independently.
   */
  extractMediaId(url: URL): string | null;
  /**
   * The player React component. Rendered by WatchPanel when watchState.providerId
   * matches this provider's id. Nothing outside the registry knows which
   * provider is mounted.
   */
  Component: React.ComponentType<ProviderPlayerProps>;
}
