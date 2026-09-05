"use client";

/**
 * Live reactions (Phase-2 feature 5). ADR 0005 §6, PM AC5.x.
 *
 * Three surfaces exported here, mounted from `RoomClient.tsx`:
 *
 *  - `ReactionsBar`      — the emoji button row (replaces Phase-1 stub).
 *  - `ReactionsOverlay`  — the floating emoji layer over the stage.
 *  - `ReactionsAnnounce` — the visually-hidden live-region for SR (AC5.6).
 *
 * Design notes:
 *  - Reactions ride the LOSSY data channel (see `reliabilityFor` in
 *    `use-room-channel.tsx`). Missed reactions are acceptable per AC5.4/5.5.
 *  - Sender-side rate limit is `ReactionLimiter` (4 / 3s per AC5.5). Denied
 *    sends are silently dropped, not queued — matches PM language.
 *  - Overlay is `pointer-events: none` and `aria-hidden` (AC5.3) — SR path
 *    is `ReactionsAnnounce`, not the visual layer.
 *  - `sendEvent` already applies the outbound event locally too, so the
 *    sender sees their own floater via the same subscribe path as remote
 *    reactions. Announce is remote-only (AC5.6 — announcing your own click
 *    is noisy for the sender).
 */

import { useEffect, useRef, useState } from "react";
import { useRoomChannel } from "@/lib/room/use-room-channel";
import { ReactionLimiter } from "@/lib/room/rate-limit";
import type { RoomEvent as ChannelEvent } from "@/lib/room/envelope";

/** Fixed emoji set per AC5.1. Do not extend without PM sign-off. */
const EMOJIS = ["😂", "❤️", "😭", "🔥"] as const;

/** How long a floater stays on screen (matches AC5.2 "3s"). */
const FLOATER_MS = 3000;

/** Cleanup buffer past the CSS transition so the DOM node is removed after
 *  the animation completes, not concurrently. */
const CLEANUP_BUFFER_MS = 100;

/** Random horizontal spawn position, in vw-relative units for the overlay. */
function randomXPercent(): number {
  return 10 + Math.random() * 80;
}

/**
 * Short, non-cryptographic id for a reaction. Extracted so the impure
 * `crypto.randomUUID` / `Date.now` / `Math.random` calls don't sit inside
 * the component body — react-hooks/purity flags any impure call declared
 * inside a component, even in an event handler.
 */
function makeReactionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().slice(0, 8);
  }
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---- Button row ----------------------------------------------------------

export function ReactionsBar({ nickname }: { nickname: string }) {
  const { sendEvent } = useRoomChannel();
  // One limiter per browser tab. Ref-owned so React doesn't reset it on
  // re-render.
  const limiterRef = useRef<ReactionLimiter | null>(null);
  if (limiterRef.current === null) {
    limiterRef.current = new ReactionLimiter(4, 3000);
  }

  const onClick = (emoji: string) => {
    if (!limiterRef.current!.tryAcquire()) {
      // AC5.5 — silently dropped, not queued.
      return;
    }
    void sendEvent({
      type: "reaction",
      emoji,
      id: makeReactionId(),
      name: nickname,
    });
  };

  return (
    <div className="flex items-center gap-4 rounded-lg border border-white bg-white/48 px-4 py-2.5 backdrop-blur">
      {EMOJIS.map((e) => (
        <button
          key={e}
          type="button"
          aria-label={`React with ${e}`}
          onClick={() => onClick(e)}
          className="flex size-6 items-center justify-center text-xl leading-none transition hover:scale-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          {e}
        </button>
      ))}
    </div>
  );
}

// ---- Floating overlay ----------------------------------------------------

interface Floater {
  key: string;
  emoji: string;
  xPercent: number;
}

export function ReactionsOverlay() {
  const { subscribe } = useRoomChannel();
  const [floaters, setFloaters] = useState<Floater[]>([]);
  // Monotonic counter so React key collisions are impossible even if two
  // reactions with the same id arrive.
  const seqRef = useRef(0);

  useEffect(() => {
    const handler = (event: ChannelEvent) => {
      if (event.type !== "reaction") return;
      const key = `${event.id}-${seqRef.current++}`;
      setFloaters((prev) => [
        ...prev,
        { key, emoji: event.emoji, xPercent: randomXPercent() },
      ]);
      // Remove after the CSS transition has visibly completed.
      window.setTimeout(() => {
        setFloaters((prev) => prev.filter((f) => f.key !== key));
      }, FLOATER_MS + CLEANUP_BUFFER_MS);
    };
    return subscribe(handler);
  }, [subscribe]);

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      // AC5.3 — z-index above stage content, below the ActionBar. The
      // ActionBar renders in a sibling container with its own stacking
      // context; this overlay stays inside the stage so it can't cover
      // the mic/cam/Leave controls.
    >
      {floaters.map((f) => (
        <span
          key={f.key}
          className="absolute select-none text-4xl reaction-floater"
          style={{
            left: `${f.xPercent}%`,
            bottom: 0,
            // CSS custom prop consumed by the keyframes below.
            animationDuration: `${FLOATER_MS}ms`,
          }}
        >
          {f.emoji}
        </span>
      ))}
      <style>{`
        @keyframes reaction-float {
          from { transform: translateY(0);       opacity: 1; }
          to   { transform: translateY(-100vh);  opacity: 0; }
        }
        .reaction-floater {
          animation-name: reaction-float;
          animation-timing-function: ease-out;
          animation-fill-mode: forwards;
        }
      `}</style>
    </div>
  );
}

// ---- Screen-reader announcer --------------------------------------------

/**
 * AC5.6 — a single visually-hidden polite live region announces inbound
 * reactions once. We write the message, then clear it shortly after so the
 * next reaction fires a fresh announcement (SR quirk: the announcer needs
 * a text change to fire again — clearing is the standard trick).
 *
 * Own-reactions are not announced: the sender clicked the button, they
 * don't need the SR to tell them. Same rate-limit posture as the visual
 * layer (already enforced on the sender side; nothing extra needed here).
 */
export function ReactionsAnnounce({ localIdentity }: { localIdentity: string }) {
  const { subscribe } = useRoomChannel();
  const [message, setMessage] = useState("");
  // Queue so bursts don't clobber each other before SR speaks.
  const pendingRef = useRef<string[]>([]);
  const clearTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const handler = (event: ChannelEvent, from: string) => {
      if (event.type !== "reaction") return;
      if (from === localIdentity) return;
      pendingRef.current.push(`${event.name} reacted with ${event.emoji}`);
      pump();
    };

    const pump = () => {
      if (clearTimerRef.current !== null) return; // SR still speaking previous
      const next = pendingRef.current.shift();
      if (next === undefined) return;
      setMessage(next);
      clearTimerRef.current = window.setTimeout(() => {
        setMessage("");
        clearTimerRef.current = null;
        // Fire the next queued message in the tick after the clear so SR
        // actually notices the text changed.
        window.setTimeout(pump, 20);
      }, 900);
    };

    return subscribe(handler);
  }, [subscribe, localIdentity]);

  useEffect(() => {
    return () => {
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
    };
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {message}
    </div>
  );
}
