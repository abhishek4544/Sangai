"use client";

/**
 * "Look at Me" self-spotlight (product ask 2026-09-05).
 *
 * When any participant clicks the "Look at Me" pill, everyone (including
 * the sender) sees:
 *
 *  - a 60%-opacity black backdrop over the whole room UI, and
 *  - the sender's participant tile lifted above the backdrop so it stays
 *    fully visible.
 *
 * Auto-clears after ~4 s. The active-spotlight identity is exposed via
 * context so `ParticipantTile` can bump its z-index when it matches; the
 * backdrop itself is a room-level absolute overlay.
 *
 * Broadcast, RELIABLE. Client-side cooldown (~4 s) so the pill can't be
 * mashed.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRoomChannel } from "@/lib/room/use-room-channel";
import type { RoomEvent as ChannelEvent } from "@/lib/room/envelope";

/** How long the spotlight lasts before auto-clearing. Kept short so it
 *  doesn't feel intrusive — Close button + click-outside + Escape are all
 *  available for earlier dismissal. */
const SPOTLIGHT_MS = 4000;

/**
 * Play a short, cartoonish "boing" via Web Audio — no asset to load, no
 * license to worry about, works on every browser we care about.
 *
 * Two-tone descending honk with a wobble ramp on the second note. Runs
 * ~500 ms end-to-end and cleans up its own AudioContext. Silently no-ops
 * if the browser blocks autoplay (mobile Safari without a prior user
 * gesture) — the visual spotlight is the reliable channel.
 */
function playLookAtMeSound(): void {
  try {
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (AudioCtx === undefined) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    // "Bwoo-eep" — up-then-down honk. 440 → 780 → 260 Hz over ~450 ms.
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.linearRampToValueAtTime(780, now + 0.12);
    osc.frequency.linearRampToValueAtTime(260, now + 0.42);

    // Envelope: quick attack, gentle decay. Kept below 0.25 so it's
    // noticeable but not a jump-scare over voice chat.
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.5);

    // Free the context once playback ends so we're not leaking AudioContexts
    // (Chrome caps at ~6 per tab).
    osc.onended = () => {
      void ctx.close().catch(() => {});
    };
  } catch {
    // Ignore — silent failure is fine, the spotlight is the primary channel.
  }
}

/** Client-side cooldown so the "Look at Me" pill can't spam a room-wide
 *  effect. Match the spotlight duration so consecutive clicks feel gated
 *  by "is the previous spotlight still up." */
const COOLDOWN_MS = SPOTLIGHT_MS;

interface SpotlightState {
  /** Identity of the participant currently being spotlighted, or null. */
  spotlightedIdentity: string | null;
  /** Display name shown in the backdrop label. */
  spotlightedName: string | null;
  /** Locally dismiss the current spotlight (Close button on the modal
   *  card). Doesn't broadcast — just clears this viewer's state. */
  dismiss: () => void;
}

const SpotlightContext = createContext<SpotlightState>({
  spotlightedIdentity: null,
  spotlightedName: null,
  dismiss: () => {},
});

/** Read the current spotlight state — used by `ParticipantTile` to decide
 *  whether it should render above the backdrop. */
export function useSpotlight(): SpotlightState {
  return useContext(SpotlightContext);
}

// ---- Provider + backdrop -------------------------------------------------

interface LookAtMeProviderProps {
  children: ReactNode;
}

export function LookAtMeProvider({ children }: LookAtMeProviderProps) {
  const { subscribe } = useRoomChannel();
  const [state, setState] = useState<{
    spotlightedIdentity: string | null;
    spotlightedName: string | null;
  }>({
    spotlightedIdentity: null,
    spotlightedName: null,
  });
  const clearTimerRef = useRef<number | null>(null);

  const dismiss = useCallback(() => {
    setState({ spotlightedIdentity: null, spotlightedName: null });
    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const handler = (event: ChannelEvent, from: string) => {
      if (event.type !== "lookAtMe") return;
      if (from.length === 0) return;
      setState({ spotlightedIdentity: from, spotlightedName: event.name });
      // Play the honk on receipt — sender hears theirs land too, so they
      // get instant feedback the click fired.
      playLookAtMeSound();
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
      }
      clearTimerRef.current = window.setTimeout(() => {
        setState({ spotlightedIdentity: null, spotlightedName: null });
        clearTimerRef.current = null;
      }, SPOTLIGHT_MS);
    };
    return subscribe(handler);
  }, [subscribe]);

  useEffect(() => {
    return () => {
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
      }
    };
  }, []);

  // Escape dismisses when a spotlight is up. Keeps the modal from feeling
  // stuck if the auto-timer or click-outside misses.
  useEffect(() => {
    if (state.spotlightedIdentity === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.spotlightedIdentity, dismiss]);

  return (
    <SpotlightContext.Provider
      value={{
        spotlightedIdentity: state.spotlightedIdentity,
        spotlightedName: state.spotlightedName,
        dismiss,
      }}
    >
      {children}
      {state.spotlightedIdentity !== null && (
        <div
          role="status"
          aria-live="polite"
          onClick={dismiss}
          // Dim only — no blur. Earlier iterations used a heavy
          // `backdrop-blur-md`, but that made the whole app look broken
          // when the spotlight fired (especially when the user was also
          // screen-sharing). A soft dim is enough to focus attention on
          // the spotlight card while keeping the rest of the room
          // readable. Clicking outside the card dismisses.
          className="fixed inset-0 z-40 bg-black/30 transition-opacity duration-300"
        />
      )}
    </SpotlightContext.Provider>
  );
}

// ---- Action-bar pill -----------------------------------------------------

interface LookAtMePillProps {
  nickname: string;
}

export function LookAtMePill({ nickname }: LookAtMePillProps) {
  const { sendEvent } = useRoomChannel();
  const [pending, setPending] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const onClick = useCallback(() => {
    if (pending) return;
    setPending(true);
    void sendEvent({ type: "lookAtMe", name: nickname });
    timerRef.current = window.setTimeout(() => {
      setPending(false);
      timerRef.current = null;
    }, COOLDOWN_MS);
  }, [pending, sendEvent, nickname]);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-pressed={pending}
      className="flex h-[45px] items-center justify-center gap-2 rounded-lg border border-black/10 bg-white/60 px-6 font-[family-name:var(--font-outfit)] text-sm font-medium text-zinc-900 backdrop-blur transition hover:bg-white/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
    >
      Look at me
    </button>
  );
}
