"use client";

/**
 * WatchPanel — Watch Mode v1.1.
 *
 * Owns the full Watch Mode UI surface inside /room/[code]:
 *   - URL input + validation
 *   - Provider dispatch (renders matched Provider.Component)
 *   - "Controlled by X" pill
 *   - "Join playback" affordance for autoplay-blocked state
 *   - "Stop Watch Mode" button
 *   - Mutual exclusion with screen-share
 *   - DRM notice (I1) + privacy disclosure (M5)
 *   - Not-supported-URL inline error (AC8)
 *
 * Security notes:
 *   M6: controller display name is rendered via React text interpolation only —
 *   no dangerouslySetInnerHTML, no HTML rendering library, no template
 *   substitution into an HTML string.
 *   M5: "Anyone in the room can start playback. Your IP goes to Google when a
 *   video plays." is shown below the URL bar on every first open.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { Room } from "livekit-client";
import { useWatchSync } from "@/lib/watch/use-watch-sync";
import { detectProvider } from "@/lib/watch/providers/index";
import type { PlayerEvent } from "@/lib/watch/providers/types";

// ---- Types ---------------------------------------------------------------

interface WatchPanelProps {
  /** LiveKit Room — used to look up participant display names. */
  room: Room | null;
  /** Whether a screen-share is currently active (disables Watch Mode URL input). */
  screenShareActive: boolean;
  /** Called when Watch Mode goes active — lets RoomClient disable the share button. */
  onWatchModeActiveChange?: (active: boolean) => void;
}

// ---- Sub-components ------------------------------------------------------

/**
 * The amber notice stripe — shown below the URL input when Watch Mode is
 * closed (idle). Uses the same amber class stack as the landing DRM notice.
 */
function WatchDrmNotice() {
  return (
    <aside
      role="note"
      aria-label="Watch Mode restrictions"
      className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
    >
      <div>
        {/* TODO: PM to finalise copy */}
        <p className="font-medium">DRM streaming won{"'"}t work here.</p>
        <p className="mt-0.5">
          Netflix, Prime, Disney+ and HBO won{"'"}t play in Watch Mode. Use
          Share a tab for those (guests will see a black frame {"—"} that{"'"}s a
          browser DRM restriction, not a bug).
        </p>
        {/* M5 (I1) — privacy disclosure: IP goes to Google when a YouTube video plays. */}
        <p className="mt-1 text-amber-800">
          Anyone in the room can start playback. Your IP goes to Google when a
          video plays.
        </p>
      </div>
    </aside>
  );
}

// ---- Main component ------------------------------------------------------

export function WatchPanel({
  room,
  screenShareActive,
  onWatchModeActiveChange,
}: WatchPanelProps) {
  const { watchState, publishLoad, publishStop, playerRef, onPlayerEvent } =
    useWatchSync();
  const inputId = useId();

  // URL bar state
  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);

  // Autoplay-blocked signal from the YouTube component.
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  // Autoplay-blocked is only meaningful while Watch Mode is active.
  // Derived during render so no effect or ref is needed.
  const effectiveAutoplayBlocked = autoplayBlocked && watchState.status === "active";

  // Ref for the "Join playback" button — focus management on autoplay block.
  const joinBtnRef = useRef<HTMLButtonElement | null>(null);

  // Notify parent when Watch Mode active state changes.
  const isActive = watchState.status === "active";
  useEffect(() => {
    onWatchModeActiveChange?.(isActive);
  }, [isActive, onWatchModeActiveChange]);

  // Focus the "Join playback" button when autoplay is blocked.
  useEffect(() => {
    if (effectiveAutoplayBlocked) {
      joinBtnRef.current?.focus();
    }
    // effectiveAutoplayBlocked is derived from autoplayBlocked + watchState.status.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplayBlocked, watchState.status]);

  // ---- URL submission handler ------------------------------------------

  const handleUrlSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setUrlError(null);

      const trimmed = urlInput.trim();
      if (!trimmed) return;

      const result = detectProvider(trimmed);

      if (result === null) {
        // detectProvider returns null for invalid/unsupported URLs.
        // Distinguish the reason by re-calling validateWatchUrl for specific copy.
        // For simplicity here, show the unsupported-URL message.
        setUrlError(
          // TODO: PM to finalise copy
          "That URL isn't supported yet. Paste a YouTube link (youtube.com or youtu.be).",
        );
        return;
      }

      // Clear any prior error state.
      setUrlError(null);
      // Publish to the room — all peers will load this video.
      publishLoad(result.provider.id, result.mediaId);
      setUrlInput("");
    },
    [urlInput, publishLoad],
  );

  // ---- Player event bridge -----------------------------------------------

  const handlePlayerEvent = useCallback(
    (event: PlayerEvent) => {
      if (event.type === "error") {
        if (event.code === "embed_refused") {
          // Per-viewer error — don't broadcast to the room.
          setUrlError(
            // TODO: PM to finalise copy
            "YouTube won't let this video play embedded — try another link.",
          );
        } else {
          // unknown: could be SDK load failure or autoplay policy.
          // Show autoplay-blocked affordance — user may need a click.
          setAutoplayBlocked(true);
        }
        return;
      }
      // Reset autoplay-blocked if playback actually starts.
      if (event.type === "play") {
        setAutoplayBlocked(false);
      }
      onPlayerEvent(event);
    },
    [onPlayerEvent],
  );

  // ---- Controller display name ------------------------------------------

  const controllerDisplayName =
    watchState.status === "active" && watchState.controllerId
      ? resolveDisplayName(room, watchState.controllerId)
      : null;

  // ---- Active provider component ----------------------------------------

  const activeProvider =
    watchState.status === "active"
      ? detectProvider(
          `https://www.youtube-nocookie.com/embed/${watchState.mediaId}`,
        )
      : null;

  // If state is active but provider lookup fails (shouldn't happen in normal
  // flow since we validated on load), treat as unsupported.
  const ProviderComponent = activeProvider?.provider.Component ?? null;

  // ---- Render -----------------------------------------------------------

  // Empty / idle state
  if (watchState.status === "idle") {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-white/70 bg-white/80 p-5 shadow-lg backdrop-blur">
        <h2 className="font-[family-name:var(--font-outfit)] text-sm font-semibold text-zinc-900">
          Watch Together
        </h2>

        <form onSubmit={handleUrlSubmit} className="flex flex-col gap-2">
          <label
            htmlFor={inputId}
            className="font-[family-name:var(--font-outfit)] text-xs font-medium text-zinc-700"
          >
            Paste a YouTube link to watch together
          </label>
          <div className="flex gap-2">
            <input
              id={inputId}
              type="url"
              value={urlInput}
              onChange={(e) => {
                setUrlInput(e.target.value);
                setUrlError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setUrlError(null);
                  setUrlInput("");
                }
              }}
              placeholder="https://www.youtube.com/watch?v=..."
              disabled={screenShareActive}
              aria-describedby={urlError ? `${inputId}-error` : undefined}
              className="min-w-0 flex-1 rounded-lg border border-black/10 bg-white px-3 py-2 font-[family-name:var(--font-outfit)] text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={screenShareActive || !urlInput.trim()}
              className="flex-shrink-0 rounded-lg bg-sky-700 px-4 py-2 font-[family-name:var(--font-outfit)] text-sm font-medium text-white transition hover:bg-sky-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Load
            </button>
          </div>

          {urlError && (
            <p
              id={`${inputId}-error`}
              role="alert"
              className="font-[family-name:var(--font-outfit)] text-xs text-red-700"
            >
              {urlError}
            </p>
          )}

          {screenShareActive && (
            <p className="font-[family-name:var(--font-outfit)] text-xs text-amber-800">
              {/* TODO: PM to finalise copy */}
              Someone is screen-sharing — stop that first to start Watch Mode.
            </p>
          )}
        </form>

        <WatchDrmNotice />
      </div>
    );
  }

  // Active Watch Mode
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-xl border border-white/70 bg-white/80 p-5 shadow-lg backdrop-blur">
      {/* Header row: controller pill + stop button */}
      <div className="flex items-center justify-between gap-2">
        {/* M6: Text interpolation only — no dangerouslySetInnerHTML. */}
        <div
          aria-live="polite"
          aria-atomic="true"
          className="flex items-center gap-1.5"
        >
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full bg-emerald-500"
          />
          <span className="font-[family-name:var(--font-outfit)] text-xs text-zinc-700">
            {controllerDisplayName ? (
              <>
                Playing &mdash; controlled by{" "}
                <span className="font-medium text-zinc-900">
                  {/* M6: plain text interpolation — React escapes this for us. */}
                  {controllerDisplayName}
                </span>
              </>
            ) : (
              "Watch Mode active"
            )}
          </span>
        </div>

        <button
          type="button"
          onClick={publishStop}
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 font-[family-name:var(--font-outfit)] text-xs font-medium text-red-700 transition hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          aria-label="Stop Watch Mode for everyone"
        >
          {/* TODO: PM to finalise copy — "any participant" posture; flag in a TODO for PM to override if host-only is preferred. */}
          Stop Watch Mode
        </button>
      </div>

      {/* Autoplay-blocked overlay */}
      {effectiveAutoplayBlocked && (
        <div
          role="alert"
          className="flex items-center justify-center rounded-lg border border-amber-300 bg-amber-50 p-4"
        >
          <button
            ref={joinBtnRef}
            type="button"
            onClick={() => {
              playerRef.current?.play();
              setAutoplayBlocked(false);
            }}
            className="rounded-lg bg-sky-700 px-5 py-2.5 font-[family-name:var(--font-outfit)] text-sm font-medium text-white transition hover:bg-sky-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            {/* TODO: PM to finalise copy */}
            Tap to join playback
          </button>
        </div>
      )}

      {/* Provider player */}
      {ProviderComponent && (
        <div className="min-h-0 flex-1">
          <ProviderComponent
            mediaId={watchState.mediaId}
            onEvent={handlePlayerEvent}
            handleRef={playerRef}
          />
        </div>
      )}

      {urlError && (
        <p
          role="alert"
          className="font-[family-name:var(--font-outfit)] text-xs text-red-700"
        >
          {urlError}
        </p>
      )}
    </div>
  );
}

// ---- Helpers -------------------------------------------------------------

/**
 * Resolve a LiveKit participant identity to a display name.
 * Falls back to the identity string itself if the participant isn't found.
 * Returns null if room is not connected or identity is empty.
 */
function resolveDisplayName(
  room: Room | null,
  identity: string,
): string | null {
  if (!room || !identity || identity === "local") return null;
  if (room.localParticipant.identity === identity) {
    const n = room.localParticipant.name;
    return n && n.length > 0 ? n : "You";
  }
  const remote = room.remoteParticipants.get(identity);
  if (!remote) return identity; // fallback to opaque identity string
  const n = remote.name;
  return n && n.length > 0 ? n : identity;
}

// ---- Watch Mode entry-point button (for ActionBar) ----------------------

interface WatchModeButtonProps {
  /** Whether Watch Mode is currently active. */
  watchActive: boolean;
  /** Whether a screen-share is currently active. */
  screenShareActive: boolean;
  /** Toggle the Watch Mode panel visibility. */
  onToggle: () => void;
}

export function WatchModeButton({
  watchActive,
  screenShareActive,
  onToggle,
}: WatchModeButtonProps) {
  const disabled = screenShareActive && !watchActive;
  const label = watchActive ? "Close Watch Mode" : "Watch Together";

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-disabled={disabled}
      aria-pressed={watchActive}
      title={
        disabled
          ? "Someone is screen-sharing — stop that first to use Watch Mode"
          : undefined
      }
      className="flex h-[45px] items-center justify-center gap-2 rounded-lg border border-black/10 bg-white/60 px-4 font-[family-name:var(--font-outfit)] text-sm font-medium text-zinc-900 backdrop-blur transition hover:bg-white/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-white/60"
    >
      <span aria-hidden className="text-base leading-none">
        &#9654;
      </span>
      {label}
    </button>
  );
}
