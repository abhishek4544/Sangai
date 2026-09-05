"use client";

/**
 * Whisper mode — TICKET-1 (Week 1). ADR 0005 §4 already reserved the wire
 * shape (`envelope.ts:WhisperSchema`) and the room-wide LWW toggle field
 * (`state.ts:whisperOn`); this module fills in the runtime:
 *
 *   1. `WhisperProvider` — when the toggle is ON, runs VAD on the local mic
 *      and broadcasts `voice-on` / `voice-off` edges. Subscribes to remote
 *      voice edges as they arrive so every peer computes the same
 *      "anyoneSpeaking" flag.
 *   2. `useWhisperDuck()` — hook returning `{ duckGain, whisperOn }`.
 *      Consumers (screen-share `<video>`, future synced-playback player)
 *      multiply their `<HTMLMediaElement>.volume` by `duckGain`. When
 *      whisperOn is false, `duckGain` is always 1.
 *   3. `WhisperTogglePill` — the action-bar button. Reads `roomState.whisperOn`
 *      and toggles it via `sendEvent` (RELIABLE per ADR §1 table).
 *
 * Voice edges are LOSSY (matches ADR §1 for `whisper.voice-*`); a missed edge
 * self-heals on the next one — worst case a duck lingers ~200ms after speech.
 * We conservatively hold the ducked state for `EDGE_TIMEOUT_MS` after the
 * last `voice-on` — if we never see the matching `voice-off` (peer dropped
 * mid-speech), we release automatically.
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
import { type Room, Track } from "livekit-client";
import { useRoomChannel } from "@/lib/room/use-room-channel";
import { VadDetector, rmsOfBlock } from "@/lib/room/vad";
import { WhisperGroupIcon } from "./icons";

/** Duck target — how far to drop shared audio volume when someone speaks. */
const DUCK_GAIN = 0.3;
/** Fade duration in ms (both duck-down and release). Kept short so the duck
 *  feels reactive, but long enough to avoid audible pops from step changes. */
const FADE_MS = 500;
/** Safety timeout — if we hear `voice-on` from a peer but never `voice-off`
 *  (peer dropped, envelope lost), release the duck after this many ms of
 *  silence. Longer than a normal utterance to avoid premature release. */
const EDGE_TIMEOUT_MS = 3000;

interface WhisperContextValue {
  /** 1.0 when nothing to duck; DUCK_GAIN when whisperOn AND someone speaking. */
  duckGain: number;
  /** Convenience passthrough of the toggle state, so consumers don't need to
   *  subscribe to `useRoomChannel` separately. */
  whisperOn: boolean;
}

const WhisperContext = createContext<WhisperContextValue | null>(null);

export function useWhisperDuck(): WhisperContextValue {
  const ctx = useContext(WhisperContext);
  // Default to no-duck when the provider isn't mounted so consumers that
  // pre-date this feature still render safely.
  return ctx ?? { duckGain: 1, whisperOn: false };
}

interface ProviderProps {
  room: Room | null;
  children: ReactNode;
}

export function WhisperProvider({ room, children }: ProviderProps) {
  const { roomState, sendEvent, subscribe } = useRoomChannel();
  const whisperOn = roomState.whisperOn;

  // Per-identity presence of speech (LWW-ish, self-healing on next edge).
  // We compute "anyone speaking" as `speakingRef.current.size > 0`.
  const speakingRef = useRef<Map<string, number>>(new Map());
  const [anyoneSpeaking, setAnyoneSpeaking] = useState(false);

  // Timers to auto-clear identities we've heard `voice-on` from but never
  // `voice-off` (protects against a lost falling-edge envelope).
  const timeoutsRef = useRef<Map<string, number>>(new Map());

  const recomputeSpeaking = useCallback(() => {
    setAnyoneSpeaking(speakingRef.current.size > 0);
  }, []);

  const clearIdentity = useCallback(
    (identity: string) => {
      speakingRef.current.delete(identity);
      const existing = timeoutsRef.current.get(identity);
      if (existing !== undefined) {
        window.clearTimeout(existing);
        timeoutsRef.current.delete(identity);
      }
      recomputeSpeaking();
    },
    [recomputeSpeaking],
  );

  // Subscribe to remote (and our own — for local echo) voice-on/off edges.
  useEffect(() => {
    const unsubscribe = subscribe((event, from) => {
      if (event.type !== "whisper") return;
      if (event.phase === "voice-on") {
        speakingRef.current.set(from, event.ts);
        // (Re)arm safety timer for this identity.
        const existing = timeoutsRef.current.get(from);
        if (existing !== undefined) window.clearTimeout(existing);
        const timer = window.setTimeout(() => {
          clearIdentity(from);
        }, EDGE_TIMEOUT_MS);
        timeoutsRef.current.set(from, timer);
        recomputeSpeaking();
      } else if (event.phase === "voice-off") {
        clearIdentity(from);
      }
      // `toggle` phases are already absorbed into roomState.whisperOn by
      // the reducer — nothing to do here.
    });
    return () => {
      unsubscribe();
      // Clear pending timers on unmount so React doesn't warn on setState-
      // after-unmount if a safety timer fires late.
      for (const t of timeoutsRef.current.values()) window.clearTimeout(t);
      timeoutsRef.current.clear();
      speakingRef.current.clear();
    };
  }, [subscribe, clearIdentity, recomputeSpeaking]);

  // Local-mic VAD loop. Only runs when whisperOn is true — no CPU cost when
  // the feature is off. Rebuilt when the mic publication changes so we always
  // sample the live track.
  useEffect(() => {
    if (!room || !whisperOn) return;

    let audioCtx: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let rafId: number | null = null;
    let cancelled = false;

    const cleanup = () => {
      cancelled = true;
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      try {
        source?.disconnect();
        analyser?.disconnect();
      } catch {
        // Already disconnected — no-op.
      }
      if (audioCtx !== null) {
        void audioCtx.close().catch(() => {});
        audioCtx = null;
      }
    };

    const start = (mediaTrack: MediaStreamTrack) => {
      if (mediaTrack.readyState !== "live") return;
      try {
        const AudioCtx =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (AudioCtx === undefined) return;
        audioCtx = new AudioCtx();
      } catch (err) {
        console.warn("[whisper] AudioContext creation failed", err);
        return;
      }
      if (audioCtx.state === "suspended") {
        void audioCtx.resume().catch(() => {});
      }
      const stream = new MediaStream([mediaTrack]);
      source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      // Whisper defaults: 80ms rising / 200ms falling — tight enough to feel
      // reactive without flapping on a syllable gap.
      const detector = new VadDetector();

      const tick = () => {
        if (cancelled || analyser === null) return;
        analyser.getFloatTimeDomainData(buffer);
        const rms = rmsOfBlock(buffer);
        const edge = detector.push({ t: performance.now(), rms });
        if (edge !== null) {
          void sendEvent({
            type: "whisper",
            phase: edge.edge === "rising" ? "voice-on" : "voice-off",
          });
        }
        rafId = window.requestAnimationFrame(tick);
      };
      rafId = window.requestAnimationFrame(tick);
    };

    // Find the current mic publication and start (or re-start on future
    // subscription). LiveKit's audio track lands on `publication.track`.
    const attach = () => {
      const pub = room.localParticipant.getTrackPublication(
        Track.Source.Microphone,
      );
      const track = pub?.track;
      if (track?.mediaStreamTrack) {
        start(track.mediaStreamTrack);
      }
    };
    attach();

    // Note: we don't subscribe to LocalTrackPublished here because toggling
    // whisperOn while the mic is live is the dominant case, and the mic
    // typically stays published for the room's lifetime. If mic-hotplug
    // becomes a real workflow later, wire that event in.

    return cleanup;
  }, [room, whisperOn, sendEvent]);

  // If whisper flips OFF, clear speaker-set so anyone-speaking snaps back
  // to false and consumers instantly un-duck.
  useEffect(() => {
    if (whisperOn) return;
    speakingRef.current.clear();
    for (const t of timeoutsRef.current.values()) window.clearTimeout(t);
    timeoutsRef.current.clear();
    setAnyoneSpeaking(false);
  }, [whisperOn]);

  const duckGain = whisperOn && anyoneSpeaking ? DUCK_GAIN : 1;

  return (
    <WhisperContext.Provider value={{ duckGain, whisperOn }}>
      {children}
    </WhisperContext.Provider>
  );
}

// ---------- Action-bar toggle ----------

export function WhisperTogglePill() {
  const { roomState, sendEvent } = useRoomChannel();
  const on = roomState.whisperOn;
  const onClick = () => {
    void sendEvent({ type: "whisper", phase: "toggle", on: !on });
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={
        on
          ? "Whisper mode ON — shared audio ducks when either of you speaks."
          : "Turn on to auto-duck shared audio when either of you speaks."
      }
      className={
        "flex h-[45px] items-center justify-center gap-2 rounded-lg border px-6 font-[family-name:var(--font-outfit)] text-sm font-medium backdrop-blur transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 " +
        (on
          ? "border-amber-300 bg-amber-100/90 text-amber-900 shadow-sm hover:bg-amber-100"
          : "border-black/10 bg-white/60 text-red-600 hover:bg-white/80")
      }
    >
      <WhisperGroupIcon
        className={on ? "size-5 text-amber-700" : "size-5 text-red-500"}
      />
      Whisper mode
    </button>
  );
}

// ---------- Consumer helper ----------

/**
 * Apply the current duck gain to an `HTMLMediaElement.volume`. Smoothly
 * ramps toward the target over `FADE_MS` so we don't hear a step. Used by
 * `ScreenShareView` and reusable for future synced-playback players.
 *
 * `basisVolume` is the caller's "normal" volume (usually 1). Duck multiplies
 * it — a caller that has its own mute state should pass their intended
 * un-ducked value here.
 */
export function useDuckedVolume(
  el: HTMLMediaElement | null,
  basisVolume = 1,
): void {
  const { duckGain } = useWhisperDuck();
  const target = basisVolume * duckGain;
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (!el) return;
    const start = performance.now();
    const from = el.volume;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / FADE_MS);
      // Linear ramp is fine for a 500ms fade — no perceptual improvement
      // from an equal-power curve at this duration.
      el.volume = from + (target - from) * p;
      if (p < 1) rafRef.current = window.requestAnimationFrame(step);
    };
    rafRef.current = window.requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    };
  }, [el, target]);
}
