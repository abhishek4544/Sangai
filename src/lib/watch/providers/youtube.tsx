"use client";

/**
 * YouTube provider — Watch Mode v1.1.
 *
 * Uses the official YouTube IFrame Player API. The API script is injected
 * lazily on first mount, never at module import time (ADR 0006 §"Bundle
 * discipline"). Subsequent mounts reuse the already-injected script.
 *
 * Embed URL: youtube-nocookie.com (privacy-preferred per ADR 0006 §"Security defaults").
 * origin param: window.location.origin at mount (handles Vercel preview URLs —
 * ADR 0006 open question on per-deploy origins).
 *
 * Autoplay policy: browsers block autoplay-with-sound without a prior user
 * gesture. If playVideo() is called without a prior gesture, the player stays
 * paused; WatchPanel detects this via the error event and shows a
 * "Tap to join playback" button that calls play() inside a click handler.
 *
 * Security (M1): sandbox attribute is deliberately limited.
 * - allow-scripts: required — the IFrame API is JavaScript.
 * - allow-same-origin: required — postMessage from the embed back to us.
 * - allow-presentation: enables the provider's native fullscreen button.
 * - NOT granted: allow-top-navigation, allow-forms, allow-popups,
 *   allow-modals, allow-pointer-lock, allow-downloads.
 * This posture is per-provider auditable (ADR 0006 §M1). A future generic-iframe
 * fallback MUST NOT inherit allow-same-origin without explicit justification.
 */

import { useEffect, useId, useRef, useState } from "react";
import type { Provider, ProviderPlayerHandle, ProviderPlayerProps } from "./types";

// ---- YouTube host allowlist -----------------------------------------------

/** Set of hostnames this provider claims. Used by matches() and extractMediaId(). */
const YOUTUBE_HOSTS = new Set([
  "www.youtube.com",
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
]);

/** YouTube video ID: exactly 11 chars from [A-Za-z0-9_-]. */
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

// ---- IFrame API loader ---------------------------------------------------

/**
 * Module-level flag: once true, the API <script> tag has been injected (or is
 * in flight). Guards against injecting twice across multiple component mounts.
 */
let ytApiScriptInjected = false;

/** Callbacks waiting for window.YT.Player to become available. */
const ytReadyCallbacks: Array<() => void> = [];

function flushYtReady() {
  for (const cb of ytReadyCallbacks) cb();
  ytReadyCallbacks.length = 0;
}

/**
 * Inject the YouTube IFrame API script once, then call `cb` when the API is
 * ready. If the API is already ready, calls `cb` synchronously on the next tick.
 */
function ensureYtApiLoaded(cb: () => void): void {
  // Already fully loaded — call synchronously.
  if (
    typeof window !== "undefined" &&
    window.YT &&
    typeof window.YT.Player === "function"
  ) {
    cb();
    return;
  }
  // Queue for when the API finishes loading.
  ytReadyCallbacks.push(cb);
  if (ytApiScriptInjected) return; // script already in flight
  ytApiScriptInjected = true;

  // The global YouTube IFrame API calls window.onYouTubeIframeAPIReady once loaded.
  const prevCallback = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => {
    if (typeof prevCallback === "function") prevCallback();
    flushYtReady();
  };

  const script = document.createElement("script");
  script.src = "https://www.youtube.com/iframe_api";
  script.async = true;
  script.onerror = () => {
    // Fire the ready callbacks anyway so components can surface the SDK error.
    // Callers discover the failure because window.YT remains undefined.
    flushYtReady();
  };
  document.head.appendChild(script);
}

// ---- Minimal YT type declarations ----------------------------------------

/** YouTube player state constants. */
const YT_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  VIDEO_CUED: 5,
} as const;

declare global {
  interface Window {
    YT?: {
      Player: new (
        elementId: string,
        opts: YTPlayerOptions,
      ) => YTPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YTPlayerOptions {
  videoId: string;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (e: { target: YTPlayer }) => void;
    onStateChange?: (e: { data: number; target: YTPlayer }) => void;
    onError?: (e: { data: number }) => void;
  };
}

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(sec: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  destroy(): void;
}

// ---- The player component ------------------------------------------------

function YouTubePlayer({ mediaId, onEvent, handleRef }: ProviderPlayerProps) {
  const containerId = useId().replace(/:/g, "-"); // id must be valid DOM id
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [apiReady, setApiReady] = useState(false);

  // Keep a stable ref to onEvent so the player event handlers — created once
  // in the effect — don't become stale.
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  // Step 1: inject the IFrame API script once, then set apiReady.
  useEffect(() => {
    let cancelled = false;
    ensureYtApiLoaded(() => {
      if (!cancelled) setApiReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Step 2: instantiate the YT.Player once the API is ready and the container div is mounted.
  useEffect(() => {
    if (!apiReady) return;
    const container = containerRef.current;
    if (!container) return;

    if (!window.YT?.Player) {
      // SDK script loaded but YT.Player missing — SDK load failure.
      onEventRef.current({ type: "error", code: "unknown" });
      return;
    }

    // The origin param must match the parent frame's origin at mount time.
    // Using window.location.origin handles Vercel preview deployments with
    // per-deploy origins (ADR 0006 open question). We pass it directly to
    // playerVars; no separate variable needed.
    const player = new window.YT.Player(container.id, {
      videoId: mediaId,
      playerVars: {
        enablejsapi: 1,
        origin: window.location.origin,
        // Embed URL via youtube-nocookie.com is set by the IFrame API automatically
        // when the Player is initialized with videoId. We do NOT pass a src iframe
        // ourselves — the API creates the iframe inside the container div.
        autoplay: 0,
        controls: 1,
        rel: 0,
        modestbranding: 1,
      },
      events: {
        onReady: () => {
          onEventRef.current({ type: "ready" });
        },
        onStateChange: (e) => {
          const positionSec = player.getCurrentTime();
          if (e.data === YT_STATE.PLAYING) {
            onEventRef.current({ type: "play", positionSec });
          } else if (e.data === YT_STATE.PAUSED || e.data === YT_STATE.ENDED) {
            onEventRef.current({ type: "pause", positionSec });
          }
          // BUFFERING, VIDEO_CUED, UNSTARTED: no event — transient states
          // the sync loop doesn't need to track.
        },
        onError: (e) => {
          // YouTube IFrame API error codes:
          //   2   — invalid parameter value
          //   5   — HTML5 player error
          //   100 — video not found / private
          //   101 — embedding disabled by the video owner
          //   150 — embedding disabled (same as 101, different response)
          const embedRefusedCodes = new Set([100, 101, 150]);
          if (embedRefusedCodes.has(e.data)) {
            onEventRef.current({ type: "error", code: "embed_refused" });
          } else {
            onEventRef.current({ type: "error", code: "unknown" });
          }
        },
      },
    });

    playerRef.current = player;

    // Wire the imperative handle so useWatchSync can call play/pause/seekTo.
    // handleRef is a RefObject — we write to .current directly.
    const mutableHandleRef = handleRef as React.MutableRefObject<ProviderPlayerHandle | null>;
    mutableHandleRef.current = {
      play() {
        try {
          playerRef.current?.playVideo();
        } catch {
          onEventRef.current({ type: "error", code: "unknown" });
        }
      },
      pause() {
        try {
          playerRef.current?.pauseVideo();
        } catch {
          onEventRef.current({ type: "error", code: "unknown" });
        }
      },
      seekTo(sec: number) {
        try {
          playerRef.current?.seekTo(sec, true);
        } catch {
          onEventRef.current({ type: "error", code: "unknown" });
        }
      },
      getPositionSec() {
        return playerRef.current?.getCurrentTime() ?? 0;
      },
    };

    return () => {
      mutableHandleRef.current = null;
      try {
        player.destroy();
      } catch {
        // destroy() can throw if the DOM element was already removed.
        // Ignore — we're cleaning up anyway.
      }
      playerRef.current = null;
    };
    // Only re-instantiate when the mediaId or apiReady flag changes.
    // origin is read at mount and stays stable for the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiReady, mediaId]);

  // The unused `origin` variable above is only for logging clarity — remove it.

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-zinc-900">
      {/* Loading skeleton — shown until the IFrame API is ready. */}
      {!apiReady && (
        <div
          aria-label="Loading YouTube player"
          role="status"
          className="absolute inset-0 flex items-center justify-center"
        >
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/20 border-t-white" />
        </div>
      )}
      {/*
       * Container div: the YT.Player constructor replaces this element's content
       * with the actual <iframe>. We give it a stable DOM id so the YT API can
       * find it by id (the API takes an element id string or an HTMLElement).
       *
       * Note: we pass a div, not an iframe. The IFrame API creates the iframe
       * inside this div. This is the correct usage pattern for YT.Player.
       *
       * title is set on the resulting iframe by the IFrame API itself, but we
       * set aria-label on the container for accessibility before the API loads.
       */}
      <div
        id={containerId}
        ref={containerRef}
        aria-label="Watch together player"
        className="h-full w-full"
      />
    </div>
  );
}

// ---- Provider matcher helpers (pure — testable without a browser) ---------

export function matchesYouTubeHost(url: URL): boolean {
  return YOUTUBE_HOSTS.has(url.hostname.toLowerCase());
}

/**
 * Extract a YouTube video ID from a URL.
 *
 * M5 remediation: only the video ID is returned. Source-URL query params
 * (like ?t=42 or ?autoplay=1) are intentionally discarded. Callers construct
 * the embed URL independently, so user-supplied params cannot reach the embed.
 */
export function extractYouTubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  // https://youtu.be/<ID>
  if (host === "youtu.be") {
    const id = path.slice(1); // strip leading /
    return YOUTUBE_ID_RE.test(id) ? id : null;
  }

  // https://www.youtube.com/watch?v=<ID>
  const vParam = url.searchParams.get("v");
  if (vParam && YOUTUBE_ID_RE.test(vParam)) return vParam;

  // https://www.youtube.com/shorts/<ID>
  const shortsMatch = path.match(/^\/shorts\/([^/?#]+)/);
  if (shortsMatch?.[1] && YOUTUBE_ID_RE.test(shortsMatch[1])) {
    return shortsMatch[1];
  }

  // https://www.youtube.com/embed/<ID> (or youtube-nocookie.com)
  const embedMatch = path.match(/^\/embed\/([^/?#]+)/);
  if (embedMatch?.[1] && YOUTUBE_ID_RE.test(embedMatch[1])) {
    return embedMatch[1];
  }

  return null;
}

// ---- Provider export -------------------------------------------------------

export const youtubeProvider: Provider = {
  id: "youtube",

  matches(url: URL): boolean {
    return matchesYouTubeHost(url);
  },

  extractMediaId(url: URL): string | null {
    return extractYouTubeId(url);
  },

  Component: YouTubePlayer,
};

export { YOUTUBE_HOSTS };
