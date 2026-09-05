"use client";

/**
 * Smart Mic + auto-mute (Phase-2 feature 3). ADR 0005 §2, §5. PM AC3.x.
 *
 * When someone shares a tab with audio and the shared audio is actually
 * playing (RMS above threshold for ≥ 1.5 s), auto-mute every participant's
 * mic. When the share stops, restore each mic to the state it was in before.
 *
 * State ownership:
 *  - `smartMicActive` — locally derived from VAD on the ScreenShareAudio
 *    track. Every peer runs the same VAD on the same track, so every peer
 *    arrives at the same value. No broadcast.
 *  - `forceOnMic` — per-participant, stored in LiveKit participant
 *    attributes as `p2.forceOnMic: "1" | "0"`. Late-joiner-visible.
 *  - `savedMicOn` — session-local memory of what the mic state was at the
 *    moment we auto-muted, so restore honours AC3.6 ("prior state, not
 *    unconditional un-mute").
 *
 * Interactions:
 *  - AC3.4 (Force on): the user un-mutes while smart-managed → toggleMic
 *    calls `handleMicToggle(true)`, which sets `p2.forceOnMic=1`. Subsequent
 *    smart-mic activations skip them.
 *  - AC3.5 (return to smart): user mutes while force-on → clear the
 *    attribute; next activation will auto-mute them again.
 *
 * The provider watches for the ScreenShareAudio track lifecycle via
 * `TrackSubscribed`/`Unsubscribed` (remote) + `LocalTrackPublished`/
 * `Unpublished` (local). Track-end is the *only* stop trigger (AC3 edge:
 * "host mutes tab in-browser without stopping share → treat as still
 * active"), so long RMS silence does NOT restore.
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
import {
  type LocalTrackPublication,
  type RemoteTrack,
  type RemoteTrackPublication,
  type Room,
  RoomEvent as LKRoomEvent,
  Track,
} from "livekit-client";
import { VadDetector, rmsOfBlock } from "@/lib/room/vad";

/** ADR §5 — rising debounce for Smart Mic (catch "audio track present but
 *  still-frame" edge case in AC3). */
const SMART_MIC_RISING_MS = 1500;
/** AC3.1: toast auto-dismisses in 4 s. */
const TOAST_MS = 4000;
/** LiveKit participant attribute key (ADR §2). */
const FORCE_ON_ATTR = "p2.forceOnMic";

interface SmartMicContextValue {
  /** True when shared-tab audio is currently detected as playing. */
  smartMicActive: boolean;
  /** Local participant's force-on-mic attribute. */
  myForceOn: boolean;
  /** Handle a mic toggle after the underlying setMicrophoneEnabled call —
   *  wraps AC3.4 (unmute-while-managed sets force-on) and AC3.5 (mute-
   *  while-force-on clears force-on). */
  handleMicToggle: (nextMicOn: boolean) => Promise<void>;
}

const SmartMicContext = createContext<SmartMicContextValue | null>(null);

export function useSmartMic(): SmartMicContextValue {
  const ctx = useContext(SmartMicContext);
  if (ctx === null) {
    throw new Error("useSmartMic must be called inside <SmartMicProvider>");
  }
  return ctx;
}

export interface SmartMicHandle {
  /** Call after `setMicrophoneEnabled(nextMicOn)` succeeds. Runs the
   *  AC3.4 (force-on) / AC3.5 (return to smart) logic. */
  handleMicToggle: (nextMicOn: boolean) => Promise<void>;
}

interface SmartMicProviderProps {
  room: Room | null;
  children: ReactNode;
  /** Optional imperative handle populated by the provider so callers who
   *  live *outside* the tree — `RoomClient`'s own `toggleMic` — can invoke
   *  the AC3.4/3.5 logic without turning into a provider consumer
   *  themselves. `null` while unmounted. */
  handleRef?: React.RefObject<SmartMicHandle | null>;
}

export function SmartMicProvider({
  room,
  children,
  handleRef,
}: SmartMicProviderProps) {
  const [smartMicActive, setSmartMicActive] = useState(false);
  const [myForceOn, setMyForceOn] = useState(false);
  const [toastKey, setToastKey] = useState<number | null>(null);

  // Refs mirror state so async callbacks (audio-graph, LiveKit event
  // handlers) see current values without re-subscribing each change.
  const smartMicActiveRef = useRef(false);
  const myForceOnRef = useRef(false);
  /** `null` when smart mic is NOT currently managing our mic; a boolean
   *  when it is (the value to restore to on stop, per AC3.2 / AC3.6). */
  const savedMicOnRef = useRef<boolean | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    smartMicActiveRef.current = smartMicActive;
  }, [smartMicActive]);
  useEffect(() => {
    myForceOnRef.current = myForceOn;
  }, [myForceOn]);

  // Seed force-on from local participant attributes on mount, and keep it
  // in sync when we (or a rebound room instance) update it via setAttributes.
  useEffect(() => {
    if (!room) return;
    const readOwnForceOn = () => {
      const v = room.localParticipant.attributes?.[FORCE_ON_ATTR];
      setMyForceOn(v === "1");
    };
    readOwnForceOn();

    const onAttrsChanged = () => {
      readOwnForceOn();
    };
    // LiveKit's ParticipantAttributesChanged fires for both local and
    // remote — we only care about local here, and it's cheap to re-read.
    room.on(LKRoomEvent.ParticipantAttributesChanged, onAttrsChanged);
    return () => {
      room.off(LKRoomEvent.ParticipantAttributesChanged, onAttrsChanged);
    };
  }, [room]);

  const setForceOnAttr = useCallback(
    async (value: boolean) => {
      if (!room) return;
      try {
        await room.localParticipant.setAttributes({
          [FORCE_ON_ATTR]: value ? "1" : "0",
        });
        setMyForceOn(value);
      } catch (err) {
        console.error("[smart-mic] setAttributes failed", err);
      }
    },
    [room],
  );

  // ---- Detection lifecycle -----------------------------------------------

  useEffect(() => {
    if (!room) return;

    // Only one active audio graph at a time — a room can only have one
    // ScreenShareAudio in flight because our UI enforces single-sharer.
    let audioGraph: {
      ctx: AudioContext;
      cleanup: () => void;
    } | null = null;

    const showToast = () => {
      setToastKey(Date.now());
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      toastTimerRef.current = window.setTimeout(() => {
        setToastKey(null);
        toastTimerRef.current = null;
      }, TOAST_MS);
    };

    const hideToast = () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
      setToastKey(null);
    };

    const applyAutoMute = () => {
      // AC3.4: skip participants whose force-on is set.
      if (myForceOnRef.current) return;
      const wasOn = room.localParticipant.isMicrophoneEnabled;
      savedMicOnRef.current = wasOn;
      // AC3.6: don't publish audio that was previously muted — but we do
      // save the state so restore honours it. If the mic was off already,
      // just record and don't touch it (skip the setMicrophoneEnabled call
      // to avoid triggering LiveKit's OverconstrainedError re-acquire path).
      if (wasOn) {
        void room.localParticipant.setMicrophoneEnabled(false).catch((err) => {
          console.error("[smart-mic] auto-mute failed", err);
        });
        showToast();
      }
    };

    const restoreMic = () => {
      const saved = savedMicOnRef.current;
      savedMicOnRef.current = null;
      hideToast();
      // AC3.6: restore to prior state, not unconditional on.
      if (saved === true) {
        void room.localParticipant
          .setMicrophoneEnabled(true)
          .catch((err) => {
            console.error("[smart-mic] restore failed", err);
          });
      }
    };

    const stopDetection = () => {
      if (audioGraph !== null) {
        audioGraph.cleanup();
        void audioGraph.ctx.close().catch(() => {});
        audioGraph = null;
      }
      if (smartMicActiveRef.current) {
        setSmartMicActive(false);
        restoreMic();
      }
    };

    const startDetection = (mediaTrack: MediaStreamTrack) => {
      // Guard against a stale/ended track being handed over.
      if (mediaTrack.readyState !== "live") return;
      // Tear down any previous graph before building a new one.
      if (audioGraph !== null) {
        audioGraph.cleanup();
        void audioGraph.ctx.close().catch(() => {});
        audioGraph = null;
      }
      let ctx: AudioContext;
      try {
        const AudioCtx =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (AudioCtx === undefined) {
          console.warn("[smart-mic] AudioContext unavailable — skipping");
          return;
        }
        ctx = new AudioCtx();
      } catch (err) {
        console.warn("[smart-mic] AudioContext creation failed", err);
        return;
      }
      // Resume if the browser suspended us (autoplay policy). We're already
      // inside a room with a click history, so this typically succeeds.
      if (ctx.state === "suspended") {
        void ctx.resume().catch(() => {});
      }
      const stream = new MediaStream([mediaTrack]);
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      const detector = new VadDetector({ risingMs: SMART_MIC_RISING_MS });
      let rafId: number | null = null;
      let cancelled = false;

      const tick = () => {
        if (cancelled) return;
        analyser.getFloatTimeDomainData(buffer);
        const rms = rmsOfBlock(buffer);
        const edge = detector.push({ t: performance.now(), rms });
        if (edge !== null && edge.edge === "rising") {
          // Shared audio is playing — activate smart mic once.
          if (!smartMicActiveRef.current) {
            setSmartMicActive(true);
            applyAutoMute();
          }
        }
        // Falling edges are ignored: trigger stop is track-end only per
        // AC3 edge case, not RMS silence.
        rafId = window.requestAnimationFrame(tick);
      };
      rafId = window.requestAnimationFrame(tick);

      audioGraph = {
        ctx,
        cleanup: () => {
          cancelled = true;
          if (rafId !== null) window.cancelAnimationFrame(rafId);
          try {
            source.disconnect();
            analyser.disconnect();
          } catch {
            // disconnect throws if already disconnected — no-op.
          }
        },
      };
    };

    // ---- Track lifecycle handlers ---------------------------------------

    const onRemoteTrackSubscribed = (
      track: RemoteTrack,
      publication: RemoteTrackPublication,
    ) => {
      if (publication.source !== Track.Source.ScreenShareAudio) return;
      if (track.mediaStreamTrack === undefined) return;
      startDetection(track.mediaStreamTrack);
    };

    const onRemoteTrackUnsubscribed = (
      _track: RemoteTrack,
      publication: RemoteTrackPublication,
    ) => {
      if (publication.source !== Track.Source.ScreenShareAudio) return;
      stopDetection();
    };

    const onLocalTrackPublished = (publication: LocalTrackPublication) => {
      if (publication.source !== Track.Source.ScreenShareAudio) return;
      const mst = publication.track?.mediaStreamTrack;
      if (mst === undefined) return;
      startDetection(mst);
    };

    const onLocalTrackUnpublished = (publication: LocalTrackPublication) => {
      if (publication.source !== Track.Source.ScreenShareAudio) return;
      stopDetection();
    };

    room.on(LKRoomEvent.TrackSubscribed, onRemoteTrackSubscribed);
    room.on(LKRoomEvent.TrackUnsubscribed, onRemoteTrackUnsubscribed);
    room.on(LKRoomEvent.LocalTrackPublished, onLocalTrackPublished);
    room.on(LKRoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished);

    // Mid-share join: if a ScreenShareAudio is already present, kick off
    // detection immediately.
    for (const participant of room.remoteParticipants.values()) {
      const pub = participant.getTrackPublication(Track.Source.ScreenShareAudio);
      const t = pub?.track;
      if (t?.mediaStreamTrack !== undefined) {
        startDetection(t.mediaStreamTrack);
        break;
      }
    }
    const ownPub = room.localParticipant.getTrackPublication(
      Track.Source.ScreenShareAudio,
    );
    const ownMst = ownPub?.track?.mediaStreamTrack;
    if (ownMst !== undefined) {
      startDetection(ownMst);
    }

    return () => {
      room.off(LKRoomEvent.TrackSubscribed, onRemoteTrackSubscribed);
      room.off(LKRoomEvent.TrackUnsubscribed, onRemoteTrackUnsubscribed);
      room.off(LKRoomEvent.LocalTrackPublished, onLocalTrackPublished);
      room.off(LKRoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished);
      if (audioGraph !== null) {
        audioGraph.cleanup();
        void audioGraph.ctx.close().catch(() => {});
        audioGraph = null;
      }
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, [room]);

  // ---- Mic toggle wrapper (AC3.4 / AC3.5) --------------------------------

  const handleMicToggle = useCallback(
    async (nextMicOn: boolean) => {
      const managed =
        smartMicActiveRef.current && !myForceOnRef.current;
      // AC3.4 — user unmutes while smart is managing them.
      if (nextMicOn && managed) {
        // Clear the saved-mic-off memo so a later restore doesn't try to
        // mute them again after track-end.
        savedMicOnRef.current = null;
        await setForceOnAttr(true);
        return;
      }
      // AC3.5 — user mutes while force-on. Return to smart-managed.
      if (!nextMicOn && myForceOnRef.current) {
        await setForceOnAttr(false);
        // If shared audio is still playing, capture "prior mic on = false"
        // so a subsequent track-end restore respects AC3.6.
        if (smartMicActiveRef.current) {
          savedMicOnRef.current = false;
        }
        return;
      }
    },
    [setForceOnAttr],
  );

  // Keep the imperative handle in sync for callers outside the tree.
  useEffect(() => {
    if (handleRef === undefined) return;
    handleRef.current = { handleMicToggle };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, handleMicToggle]);

  return (
    <SmartMicContext.Provider
      value={{
        smartMicActive,
        myForceOn,
        handleMicToggle,
      }}
    >
      {children}
      <SmartMicToast toastKey={toastKey} />
    </SmartMicContext.Provider>
  );
}

// ---- Toast (AC3.1) -------------------------------------------------------

function SmartMicToast({ toastKey }: { toastKey: number | null }) {
  if (toastKey === null) return null;
  return (
    <div
      key={toastKey}
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed left-1/2 top-4 z-40 -translate-x-1/2 rounded-lg border border-zinc-300 bg-white/95 px-4 py-2 text-sm text-zinc-900 shadow-lg backdrop-blur"
    >
      Your mic was muted because the movie started.
    </div>
  );
}

// ---- Indicator (AC3.3) ---------------------------------------------------

/**
 * Small badge on the mic tile summarizing smart-mic state for the local
 * participant. AC3.3: "Smart mic" while auto-managed; changes to "Force-on"
 * when the user has overridden via AC3.4.
 *
 * Nothing to show when smart mic is inactive.
 */
export function SmartMicIndicator() {
  const { smartMicActive, myForceOn } = useSmartMic();
  if (!smartMicActive) return null;
  const label = myForceOn ? "Force-on" : "Smart mic";
  const color = myForceOn
    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
    : "border-sky-300 bg-sky-50 text-sky-800";
  return (
    <span
      className={`pointer-events-none absolute left-1.5 bottom-1.5 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${color}`}
    >
      {label}
    </span>
  );
}
