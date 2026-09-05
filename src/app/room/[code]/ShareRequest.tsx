"use client";

/**
 * Share-request UX (product ask 2026-09-05).
 *
 * When someone else is sharing, our Share button flips to "Request to
 * Share". Click sends a targeted `shareRequest` event to the current
 * sharer. The sharer sees a compact toast — "<name> wants to share" —
 * with a "Yield" button that stops their share. Toast auto-dismisses at
 * 6 s. No explicit grant step: LiveKit track events are the source of
 * truth for "who is sharing", so as soon as the sharer stops, the
 * requester's Share button re-enables on its own.
 */

import { useEffect, useRef, useState } from "react";
import { useRoomChannel } from "@/lib/room/use-room-channel";
import type { RoomEvent as ChannelEvent } from "@/lib/room/envelope";

const TOAST_DURATION_MS = 6000;
/** Client-side cooldown so the "Request to Share" button can't be spammed. */
const REQUEST_COOLDOWN_MS = 5000;

// ---- Requester-side hook + button state ---------------------------------

/**
 * Send a share-request to the currently-sharing participant. Returns a
 * function to invoke on click, plus a `pending` flag the UI can render as
 * "Requested…" for a couple of seconds.
 *
 * Cooldown is per-tab; two rapid clicks fire only one request. The button
 * label stays "Requested…" for the cooldown window so the requester sees
 * their action land even though the wire event is fire-and-forget.
 */
export function useShareRequest(
  currentSharerIdentity: string | null,
  nickname: string,
) {
  const { sendEvent } = useRoomChannel();
  const [pending, setPending] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const request = () => {
    if (pending) return;
    if (currentSharerIdentity === null) return;
    setPending(true);
    void sendEvent(
      { type: "shareRequest", name: nickname },
      { destinationIdentities: [currentSharerIdentity] },
    );
    timerRef.current = window.setTimeout(() => {
      setPending(false);
      timerRef.current = null;
    }, REQUEST_COOLDOWN_MS);
  };

  return { pending, request };
}

// ---- Sharer-side toast ---------------------------------------------------

interface ShareRequestToastProps {
  /** True when the local participant is currently sharing — the toast only
   *  makes sense to render for the sharer. */
  isSharing: boolean;
  /** Called when the sharer clicks "Yield" — parent stops the screen share. */
  onYield: () => void;
}

export function ShareRequestToast({ isSharing, onYield }: ShareRequestToastProps) {
  const { subscribe } = useRoomChannel();
  const [requesterName, setRequesterName] = useState<string | null>(null);
  const dismissTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const handler = (event: ChannelEvent) => {
      if (event.type !== "shareRequest") return;
      // Only surface requests while we're the current sharer. A stale
      // request landing after we've stopped is ignored.
      if (!isSharing) return;
      setRequesterName(event.name);
      if (dismissTimerRef.current !== null) {
        window.clearTimeout(dismissTimerRef.current);
      }
      dismissTimerRef.current = window.setTimeout(() => {
        setRequesterName(null);
        dismissTimerRef.current = null;
      }, TOAST_DURATION_MS);
    };
    return subscribe(handler);
  }, [subscribe, isSharing]);

  useEffect(() => {
    return () => {
      if (dismissTimerRef.current !== null) {
        window.clearTimeout(dismissTimerRef.current);
      }
    };
  }, []);

  // Render-gate on `isSharing` so a stale name state left over from a
  // previous share can't flash back. State-clearing lives here (derived)
  // rather than in an effect (react-hooks/set-state-in-effect).
  if (!isSharing || requesterName === null) return null;

  const dismiss = () => {
    setRequesterName(null);
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto fixed bottom-24 left-1/2 z-30 -translate-x-1/2 rounded-lg border border-sky-300 bg-white/95 px-4 py-3 shadow-lg backdrop-blur"
    >
      <div className="flex items-center gap-3">
        <span className="font-[family-name:var(--font-outfit)] text-sm text-zinc-900">
          <span className="font-medium">{requesterName}</span> wants to share
        </span>
        <button
          type="button"
          onClick={() => {
            onYield();
            dismiss();
          }}
          className="rounded-md border border-sky-300 bg-sky-500 px-3 py-1 text-xs font-medium text-white shadow-sm transition hover:bg-sky-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          Yield
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="rounded-md px-2 py-1 text-xs text-zinc-500 transition hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          Ignore
        </button>
      </div>
    </div>
  );
}
