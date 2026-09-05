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

/** Burst — one click = this many floaters. Product ask 2026-09-06. */
const BURST_COUNT = 1000;

/** Total time we spread the burst across so 1000 emojis don't all land in the
 *  same frame. ~2s feels like reaction-rain, not a wall. */
const BURST_STAGGER_MS = 2000;

/** Max floaters we allow on screen concurrently. Beyond this we drop new
 *  spawns to keep frame rate up on lower-end devices. 1000 spawned over 2s
 *  with 3s lifetime → peak ~1000; the cap trims that to a safe ceiling. */
const CONCURRENT_FLOATER_CAP = 500;

/** Random horizontal spawn position (percent of overlay width). Widened to
 *  near-full-width so 500 concurrent floaters really do spread. */
function randomXPercent(): number {
  return 2 + Math.random() * 96;
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
      count: BURST_COUNT,
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
  durationMs: number;
  /** Font size in rem — random per floater for depth-of-field feel. */
  sizeRem: number;
  /** Horizontal drift in vw the emoji travels while rising (±). Non-zero so
   *  paths diverge; two floaters spawned at the same X won't overlap. */
  driftVw: number;
}

/** Size range (rem). Small ≈ far away / background; large ≈ up close. */
const MIN_SIZE_REM = 1.25;
const MAX_SIZE_REM = 4.5;

/** Extra random per-floater delay ON TOP of the stagger gap, so the rain
 *  clumps and thins irregularly instead of ticking metronomically. */
const EXTRA_JITTER_MS = 500;

/** Maximum horizontal drift (± this value in vw) applied over the floater's
 *  lifetime. Adds sideways motion so vertical paths don't stack. */
const MAX_DRIFT_VW = 12;

export function ReactionsOverlay() {
  const { subscribe } = useRoomChannel();
  const [floaters, setFloaters] = useState<Floater[]>([]);
  // Monotonic counter so React key collisions are impossible even if two
  // reactions with the same id arrive.
  const seqRef = useRef(0);

  useEffect(() => {
    const timers = new Set<number>();
    const scheduleSpawn = (emoji: string, id: string, delay: number) => {
      const t = window.setTimeout(() => {
        timers.delete(t);
        // Compute random visuals ONCE, out here — inside setFloaters the
        // updater is impure and React 18 Strict Mode double-invokes it in
        // dev, which lets random values resolve inconsistently.
        const key = `${id}-${seqRef.current++}`;
        const xPercent = randomXPercent();
        const durationMs = FLOATER_MS + Math.random() * 800;
        const sizeRem =
          MIN_SIZE_REM + Math.random() * (MAX_SIZE_REM - MIN_SIZE_REM);
        const driftVw = (Math.random() * 2 - 1) * MAX_DRIFT_VW;
        setFloaters((prev) => {
          // Concurrent cap — drop new spawns rather than choke the compositor.
          if (prev.length >= CONCURRENT_FLOATER_CAP) return prev;
          return [
            ...prev,
            { key, emoji, xPercent, durationMs, sizeRem, driftVw },
          ];
        });
        const cleanup = window.setTimeout(() => {
          setFloaters((prev) => prev.filter((f) => f.key !== key));
        }, FLOATER_MS + 800 + CLEANUP_BUFFER_MS);
        timers.add(cleanup);
      }, delay);
      timers.add(t);
    };

    const handler = (event: ChannelEvent) => {
      if (event.type !== "reaction") return;
      const count = event.count ?? 1;
      if (count === 1) {
        scheduleSpawn(event.emoji, event.id, 0);
        return;
      }
      // Stagger the burst across BURST_STAGGER_MS. Even spacing feels
      // mechanical; per-emoji jitter (up to ±half-gap + an extra bounded
      // random) makes the rain clump and thin naturally.
      const gap = BURST_STAGGER_MS / count;
      for (let i = 0; i < count; i++) {
        const jitter = (Math.random() - 0.5) * gap;
        const extra = Math.random() * EXTRA_JITTER_MS;
        const delay = Math.max(0, i * gap + jitter + extra);
        scheduleSpawn(event.emoji, event.id, delay);
      }
    };
    const unsubscribe = subscribe(handler);
    return () => {
      unsubscribe();
      for (const t of timers) window.clearTimeout(t);
    };
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
          className="absolute select-none leading-none reaction-floater"
          style={
            {
              left: `${f.xPercent}%`,
              bottom: 0,
              fontSize: `${f.sizeRem}rem`,
              animationDuration: `${f.durationMs}ms`,
              // Per-floater horizontal drift consumed by the keyframe below.
              ["--drift" as string]: `${f.driftVw}vw`,
            } as React.CSSProperties
          }
        >
          {f.emoji}
        </span>
      ))}
      <style>{`
        @keyframes reaction-float {
          from { transform: translate(0, 0);                    opacity: 1; }
          to   { transform: translate(var(--drift, 0), -100vh); opacity: 0; }
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
