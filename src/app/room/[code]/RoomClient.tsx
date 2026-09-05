"use client";

/**
 * The LiveKit-backed room UI.
 *
 * Why raw `livekit-client` instead of `@livekit/components-react`:
 * - `@livekit/components-react` is another dependency (~40KB gz) and it pulls
 *   in higher-level UI abstractions (VideoConference, ControlBar, GridLayout)
 *   that we'd immediately re-skin with Tailwind. For a four-tile MVP with a
 *   screen-share promote-to-primary rule, the primitives — `Room.on(...)` +
 *   `track.attach(<video>)` — are simpler and give us direct control over
 *   layout and a11y.
 * - The brief explicitly told us not to add `@livekit/components-react` just
 *   for this if the primitives are enough. They are.
 *
 * Lifecycle:
 * - On mount, read `{ token, url, nickname, isHost }` from sessionStorage
 *   (keyed by lowercased code). Missing → bounce to `/?join=<code>`.
 * - Construct a `Room`, wire event listeners, `room.connect(url, token)`.
 * - Try to publish camera + mic. If the user denies at the browser prompt we
 *   stay connected and show the tile without media (per PM AC3).
 * - Host: after connect, `localParticipant.setName(nickname)` so remote
 *   participants see the display label (backend doesn't accept nickname on
 *   /api/rooms yet — this closes that gap).
 * - `beforeunload` handler is intentionally *not* installed — PM decision.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  DisconnectReason,
  MediaDeviceFailure,
  type Participant,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
} from "livekit-client";
import { clearRoomSession, loadRoomSession } from "@/lib/room-session";
import { RoomChannelProvider } from "@/lib/room/use-room-channel";
import {
  ReactionsAnnounce,
  ReactionsBar,
  ReactionsOverlay,
} from "./Reactions";
import { HoldBanner } from "./WaitForMe";
import { ShareRequestToast, useShareRequest } from "./ShareRequest";
import { LookAtMePill, LookAtMeProvider, useSpotlight } from "./LookAtMe";
import {
  SmartMicIndicator,
  SmartMicProvider,
  type SmartMicHandle,
} from "./SmartMic";
import { ChatNotifications, ChatPanel } from "./Chat";
import { BackgroundPicker } from "./BackgroundPicker";
import {
  WhisperProvider,
  WhisperTogglePill,
  useDuckedVolume,
} from "./Whisper";
import { GamesPanel } from "./GamesPanel";
import {
  DEFAULT_BACKGROUND_ID,
  getBackground,
  loadStoredBackground,
  storeBackground,
} from "@/lib/backgrounds";
import { useRoomChannel } from "@/lib/room/use-room-channel";
import {
  CopyIcon,
  DragHandleIcon,
  FullscreenIcon,
  LeaveIcon,
  MicIcon,
  MicOffIcon,
  ShareScreenIcon,
  SparkleIcon,
  VideoIcon,
  VideoOffIcon,
} from "./icons";

interface Props {
  code: string;
}

type Phase =
  | "loading"
  | "no-session"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "ended"
  | "error";

interface ScreenShareInfo {
  participantIdentity: string;
  /** Whether the sharer is the local participant — we mute the preview video
   *  element in that case (belt-and-braces guard against a browser or a
   *  future LiveKit change routing screen-share audio into the local video
   *  attach). */
  isLocal: boolean;
  /** The screen-share video track. `LocalVideoTrack` for the sharer,
   *  `RemoteVideoTrack` for a viewer — both extend `Track` and expose the
   *  same `attach(el)` API. */
  videoTrack: Track;
}

// React context is the clean way to hand the Room instance down to nested
// tiles without prop-drilling or the classic `window.__foo__` hack.
const RoomContext = createContext<Room | null>(null);
const useRoom = () => useContext(RoomContext);

export default function RoomClient({ code }: Props) {
  const router = useRouter();

  // Read the stashed session ONCE, at mount. `loadRoomSession` runs
  // `JSON.parse` and returns a fresh object on every call, so it is not a
  // valid `useSyncExternalStore` snapshot (fails Object.is on every render →
  // "getSnapshot should be cached" loop). We don't need reactivity here:
  // sessionStorage doesn't fire same-tab events, and the only writer is
  // `clearRoomSession` on this same component's leave path — which immediately
  // navigates away, so re-reading storage would be pointless.
  const [session] = useState(() => loadRoomSession(code));

  // `phase` is derived: if no session, we're redirecting; otherwise start at
  // "connecting" (the room-connect effect immediately flips this). Once the
  // effect fires it'll take over via setPhase.
  const [phase, setPhase] = useState<Phase>(
    session ? "connecting" : "no-session",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Room lives in a ref because it's a live imperative object whose identity
  // never changes during a session. `room` state below is what triggers
  // re-renders when the ref is set/torn down.
  const roomRef = useRef<Room | null>(null);
  const [room, setRoom] = useState<Room | null>(null);

  // Imperative bridge to SmartMicProvider — populated by the provider on
  // mount; consumed by our toggleMic callback (which lives outside the
  // provider tree) to run the AC3.4/3.5 force-on logic after a toggle.
  const smartMicHandleRef = useRef<SmartMicHandle | null>(null);

  // Participant snapshot — re-derived from Room events so React knows to
  // re-render tiles when someone joins/leaves.
  const [participantSnapshot, setParticipantSnapshot] = useState<
    ParticipantSnapshot[]
  >([]);

  const [screenShare, setScreenShare] = useState<ScreenShareInfo | null>(null);
  const [micEnabled, setMicEnabled] = useState(false);
  const [camEnabled, setCamEnabled] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [screenShareError, setScreenShareError] = useState<string | null>(null);
  const [mediaWarning, setMediaWarning] = useState<string | null>(null);
  const [copiedToast, setCopiedToast] = useState(false);
  // Captured when we first hit "connected"; drives the "Together for X" timer.
  const [sessionStartAt, setSessionStartAt] = useState<number | null>(null);

  // ---------------- Redirect when no session --------------------------------
  // Direct-URL paste with no stashed token — bounce back to the join form
  // with the code pre-filled. Effect is pure side-effect (no setState); the
  // phase is already "no-session" from the synchronous session read above.
  useEffect(() => {
    if (session === null) {
      router.replace(`/?join=${encodeURIComponent(code)}`);
    }
  }, [session, code, router]);

  // ---------------- Connect to LiveKit ---------------------------------------
  useEffect(() => {
    if (!session) return;
    if (roomRef.current) return; // Strict-mode double-mount guard.

    let cancelled = false;

    const r = new Room({
      // LiveKit built-ins; keep four tiles from saturating a laptop.
      adaptiveStream: true,
      dynacast: true,
      // Capture at 720p so we have real quality to promote when a tile
      // grows (Look-at-Me spotlight or fullscreen share). Without this,
      // LiveKit falls back to modest capture resolution + adaptiveStream
      // pushes the smallest layer to fit the 131-px tile, so a zoom-in
      // looks blurry.
      videoCaptureDefaults: {
        resolution: VideoPresets.h720.resolution,
      },
      publishDefaults: {
        // Simulcast so the SFU has a high layer to promote to when a
        // subscriber's viewport tile grows, and lower layers for the
        // small default tiles.
        simulcast: true,
        videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
      },
    });
    roomRef.current = r;
    setRoom(r);
    setPhase("connecting");

    const refreshParticipants = () => {
      const list = collectParticipants(r);
      setParticipantSnapshot(list);
      setScreenShare(findScreenShare(r));
      // Mirror local publish state; can drift when LiveKit itself flips it.
      const lp = r.localParticipant;
      setMicEnabled(lp.isMicrophoneEnabled);
      setCamEnabled(lp.isCameraEnabled);
      setScreenSharing(lp.isScreenShareEnabled);
    };

    const onConnected = () => {
      if (cancelled) return;
      setPhase("connected");
      setSessionStartAt((prev) => prev ?? Date.now());
      // Per ADR 0005 §8, the host token now carries `name` at mint time, so
      // no post-connect `setName` call is needed here.
      refreshParticipants();
    };

    const onReconnecting = () => setPhase("reconnecting");
    const onReconnected = () => setPhase("connected");
    const onDisconnected = (reason?: DisconnectReason) => {
      if (cancelled) return;
      if (
        reason === DisconnectReason.ROOM_DELETED ||
        reason === DisconnectReason.ROOM_CLOSED ||
        reason === DisconnectReason.SERVER_SHUTDOWN
      ) {
        setPhase("ended");
      } else {
        setPhase("disconnected");
      }
    };

    // We only ever want to re-derive our participant snapshot on any of these
    // events. The specific event args are irrelevant to our render, so the
    // handlers ignore them — LiveKit's typing accepts callbacks with fewer
    // args than the event signature declares.
    const onAnyParticipantChange = () => refreshParticipants();

    const onMediaDevicesError = (err: Error) => {
      const failure = MediaDeviceFailure.getFailure(err);
      if (failure === MediaDeviceFailure.PermissionDenied) {
        setMediaWarning(
          "Camera or mic permission was denied. You can still join and hear others; grant permission and reload to publish.",
        );
      } else if (failure === MediaDeviceFailure.NotFound) {
        setMediaWarning("No camera or microphone found on this device.");
      } else if (failure === MediaDeviceFailure.DeviceInUse) {
        setMediaWarning("Camera or microphone is in use by another app.");
      } else {
        setMediaWarning("Couldn't access your camera or microphone.");
      }
      refreshParticipants();
    };

    r.on(RoomEvent.Connected, onConnected);
    r.on(RoomEvent.Reconnecting, onReconnecting);
    r.on(RoomEvent.Reconnected, onReconnected);
    r.on(RoomEvent.Disconnected, onDisconnected);
    r.on(RoomEvent.ParticipantConnected, onAnyParticipantChange);
    r.on(RoomEvent.ParticipantDisconnected, onAnyParticipantChange);
    r.on(RoomEvent.TrackSubscribed, onAnyParticipantChange);
    r.on(RoomEvent.TrackUnsubscribed, onAnyParticipantChange);
    r.on(RoomEvent.TrackMuted, onAnyParticipantChange);
    r.on(RoomEvent.TrackUnmuted, onAnyParticipantChange);
    r.on(RoomEvent.LocalTrackPublished, onAnyParticipantChange);
    r.on(RoomEvent.LocalTrackUnpublished, onAnyParticipantChange);
    r.on(RoomEvent.ParticipantNameChanged, onAnyParticipantChange);
    r.on(RoomEvent.MediaDevicesError, onMediaDevicesError);

    (async () => {
      try {
        await r.connect(session.url, session.token);
        if (cancelled) return;

        // Try to publish camera + mic. If denied, LiveKit emits
        // MediaDevicesError (handled above). We stay connected either way
        // (per PM AC3).
        try {
          await r.localParticipant.setMicrophoneEnabled(true);
        } catch (err) {
          console.error("[room] mic enable failed", err);
        }
        try {
          await r.localParticipant.setCameraEnabled(true);
        } catch (err) {
          console.error("[room] cam enable failed", err);
        }
        refreshParticipants();
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error("[room] connect failed", err);
        setErrorMessage(msg);
        setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
      // Detach listeners before disconnect so events during teardown don't
      // touch state on an unmounted component.
      r.off(RoomEvent.Connected, onConnected);
      r.off(RoomEvent.Reconnecting, onReconnecting);
      r.off(RoomEvent.Reconnected, onReconnected);
      r.off(RoomEvent.Disconnected, onDisconnected);
      r.off(RoomEvent.ParticipantConnected, onAnyParticipantChange);
      r.off(RoomEvent.ParticipantDisconnected, onAnyParticipantChange);
      r.off(RoomEvent.TrackSubscribed, onAnyParticipantChange);
      r.off(RoomEvent.TrackUnsubscribed, onAnyParticipantChange);
      r.off(RoomEvent.TrackMuted, onAnyParticipantChange);
      r.off(RoomEvent.TrackUnmuted, onAnyParticipantChange);
      r.off(RoomEvent.LocalTrackPublished, onAnyParticipantChange);
      r.off(RoomEvent.LocalTrackUnpublished, onAnyParticipantChange);
      r.off(RoomEvent.ParticipantNameChanged, onAnyParticipantChange);
      r.off(RoomEvent.MediaDevicesError, onMediaDevicesError);
      void r.disconnect();
      roomRef.current = null;
      setRoom(null);
    };
    // Depend only on session — reconnecting on nickname changes would tear
    // the room down.
  }, [session]);

  // ---------------- Controls -------------------------------------------------

  const toggleMic = useCallback(async () => {
    const r = roomRef.current;
    if (!r) return;
    try {
      const next = !r.localParticipant.isMicrophoneEnabled;
      await r.localParticipant.setMicrophoneEnabled(next);
      setMicEnabled(next);
      // AC3.4 / AC3.5 — force-on flips ride alongside the toggle.
      await smartMicHandleRef.current?.handleMicToggle(next);
    } catch (err) {
      console.error("[room] toggleMic failed", err);
      setMediaWarning("Couldn't toggle the microphone.");
    }
  }, []);

  const toggleCam = useCallback(async () => {
    const r = roomRef.current;
    if (!r) return;
    try {
      const next = !r.localParticipant.isCameraEnabled;
      await r.localParticipant.setCameraEnabled(next);
      setCamEnabled(next);
    } catch (err) {
      console.error("[room] toggleCam failed", err);
      setMediaWarning("Couldn't toggle the camera.");
    }
  }, []);

  const toggleScreenShare = useCallback(async () => {
    const r = roomRef.current;
    if (!r) return;
    setScreenShareError(null);
    try {
      const next = !r.localParticipant.isScreenShareEnabled;
      // `audio: true` asks the browser to include tab/system audio. Chrome
      // and Edge honor it on tab shares; Safari doesn't offer it. If the
      // user unchecks "Share tab audio" or picks a window/screen, the audio
      // track just won't be published — that's fine.
      await r.localParticipant.setScreenShareEnabled(next, { audio: true });
      setScreenSharing(next);
    } catch (err) {
      // Most common case: the user hit Cancel on the picker — the browser
      // throws NotAllowedError. That's a no-op, not a real error.
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setScreenShareError("Screen share cancelled.");
      } else {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error("[room] toggleScreenShare failed", err);
        setScreenShareError(`Couldn't start screen share: ${msg}`);
      }
    }
  }, []);

  const copyCode = useCallback(async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(code);
      } else {
        // Fallback for browsers without the Async Clipboard API. Rare on
        // desktop Chrome/Edge but useful in Safari private windows.
        const ta = document.createElement("textarea");
        ta.value = code;
        ta.setAttribute("readonly", "");
        ta.style.position = "absolute";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopiedToast(true);
      window.setTimeout(() => setCopiedToast(false), 2000);
    } catch (err) {
      console.error("[room] copy failed", err);
    }
  }, [code]);

  const leaveRoom = useCallback(() => {
    const r = roomRef.current;
    clearRoomSession(code);
    if (r) void r.disconnect();
    router.push("/");
  }, [code, router]);

  const goHome = useCallback(() => {
    clearRoomSession(code);
    router.push("/");
  }, [code, router]);

  // ---------------- Render ---------------------------------------------------

  if (phase === "loading" || phase === "no-session") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-sm text-zinc-400">
        {phase === "no-session" ? "Redirecting to join…" : "Loading…"}
      </div>
    );
  }

  if (phase === "ended") {
    return (
      <RoomEndedScreen
        title="Room ended"
        message="Everyone left, or the host closed the room."
        onHome={goHome}
      />
    );
  }

  if (phase === "error") {
    return (
      <RoomEndedScreen
        title="Couldn't connect to the room"
        message={errorMessage ?? "Something went wrong reaching the media server."}
        onHome={goHome}
      />
    );
  }

  const hostIdentity = room?.localParticipant.identity;
  // NOTE: the `hostIdentity` above is really the *local participant's*
  // identity — a pre-existing naming carry-over from when only the host
  // could share. Aliased below for the share-collision check so the code
  // reads "not me". Fixing the historical name is out of scope here.
  const localIdentity = hostIdentity;

  return (
    <RoomContext.Provider value={room}>
      <RoomChannelProvider room={room}>
      <LookAtMeProvider>
      <SmartMicProvider room={room} handleRef={smartMicHandleRef}>
      <WhisperProvider room={room}>
      <div
        className="relative flex h-screen flex-col overflow-hidden [color-scheme:light]"
      >
        <BackgroundLayer roomCode={code} />

        <RoomHeader
          code={code}
          phase={phase}
          copiedToast={copiedToast}
          onCopyCode={copyCode}
          onLeave={leaveRoom}
          nickname={session?.nickname}
        />

        {mediaWarning && (
          <div
            role="alert"
            className="relative mx-3 mt-2 shrink-0 rounded-md border border-amber-300/70 bg-amber-50/90 px-3 py-2 text-sm text-amber-900 backdrop-blur"
          >
            {mediaWarning}
          </div>
        )}

        <div className="relative mx-3 mb-3 mt-2 flex min-h-0 flex-1 gap-2 rounded-lg border border-white bg-white/40 p-2 backdrop-blur-sm">
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <ShareStage
              screenShare={screenShare}
              startAt={sessionStartAt}
              participants={participantSnapshot}
              hostIdentity={hostIdentity}
              micEnabled={micEnabled}
              camEnabled={camEnabled}
              onToggleMic={toggleMic}
              onToggleCam={toggleCam}
              localIdentity={localIdentity ?? ""}
            />
            <ActionBar
              screenSharing={screenSharing}
              currentSharerIdentity={
                screenShare !== null &&
                screenShare.participantIdentity !== localIdentity
                  ? screenShare.participantIdentity
                  : null
              }
              screenShareError={screenShareError}
              onToggleScreenShare={toggleScreenShare}
              nickname={session?.nickname ?? "Guest"}
              localIdentity={localIdentity ?? ""}
            />
          </div>

          {/* Right sidebar states:
              - Screen-share (Figma 16:1069): faces on top, chat below.
              - Couple, no share: reserved for future fun games — an empty
                surface so the stage-left / games-right split is stable and
                a guest arriving doesn't reflow the whole page.
              - Solo (Figma 21:2608): hidden entirely; the self-cam takes
                the full width and floating ChatNotifications overlay the
                stage. */}
          {screenShare !== null ? (
            <aside className="flex w-[254px] shrink-0 flex-col gap-2">
              <ParticipantColumn
                participants={participantSnapshot}
                hostIdentity={hostIdentity}
                micEnabled={micEnabled}
                camEnabled={camEnabled}
                onToggleMic={toggleMic}
                onToggleCam={toggleCam}
              />
              <ChatPanel
                nickname={session?.nickname ?? "Guest"}
                localIdentity={localIdentity ?? ""}
              />
            </aside>
          ) : participantSnapshot.length >= 2 ? (
            <aside className="flex w-[416px] shrink-0 flex-col gap-2">
              <GamesPanel room={room} />
            </aside>
          ) : null}
        </div>
        {/* AC5.6 — single visually-hidden polite live region for reactions. */}
        {localIdentity !== undefined && (
          <ReactionsAnnounce localIdentity={localIdentity} />
        )}
        {/* Share-request toast — shows when someone else wants the stage
            and I'm currently the one sharing. `Yield` stops my share. */}
        <ShareRequestToast
          isSharing={screenSharing}
          onYield={toggleScreenShare}
        />
      </div>
      </WhisperProvider>
      </SmartMicProvider>
      </LookAtMeProvider>
      </RoomChannelProvider>
    </RoomContext.Provider>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function RoomHeader({
  code,
  phase,
  copiedToast,
  onCopyCode,
  onLeave,
  nickname,
}: {
  code: string;
  phase: Phase;
  copiedToast: boolean;
  onCopyCode: () => void;
  onLeave: () => void;
  nickname: string | undefined;
}) {
  return (
    <header className="relative flex items-center justify-between gap-3 px-3 pt-3">
      {/* Left: logo + "Movie Night" brand pill — matches Figma nodes 16:1674,
          16:1232, 16:1069. The Live pill is only shown when the connection
          state is anything other than connected so it doesn't clutter the
          happy path. */}
      <div className="flex items-center gap-3">
        <div className="relative flex size-10 items-center justify-center overflow-hidden rounded-md border border-white bg-[#FFCC00] shadow-sm backdrop-blur">
          <span
            aria-hidden
            className="absolute left-[5px] top-[-10px] font-[family-name:var(--font-gasoek)] text-[38px] leading-none text-[#443506]"
          >
            S
          </span>
          <span className="sr-only">Sangai</span>
        </div>
        <div className="rounded-lg border border-white bg-white/80 px-3 py-1.5 shadow-sm backdrop-blur">
          <span className="font-[family-name:var(--font-outfit)] text-sm text-zinc-900">
            Movie Night
          </span>
        </div>
        {phase !== "connected" && <ConnectionPill phase={phase} />}
      </div>

      {/* Right: room code + avatar + leave */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-4 rounded-lg border border-white bg-white/80 px-3 py-1.5 shadow-sm backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="font-[family-name:var(--font-outfit)] text-sm text-zinc-900">
              Room Code:
            </span>
            <button
              type="button"
              onClick={onCopyCode}
              aria-label={copiedToast ? "Copied" : `Copy room code ${code}`}
              className="flex w-[148px] items-center justify-between rounded-lg border border-black/10 bg-white/70 px-3 py-1.5 transition hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            >
              <span className="truncate font-[family-name:var(--font-outfit)] text-sm font-medium tracking-[3px] text-zinc-900">
                {code}
              </span>
              {copiedToast ? (
                <span className="text-xs font-medium text-emerald-600">
                  Copied
                </span>
              ) : (
                <CopyIcon className="size-4 text-zinc-700" />
              )}
            </button>
          </div>
          <div
            aria-hidden
            className="flex size-[34px] items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-sky-400 to-indigo-500 text-sm font-semibold text-white"
          >
            {initialOf(nickname ?? "")}
          </div>
        </div>
        <button
          type="button"
          onClick={onLeave}
          aria-label="Leave room"
          className="flex size-[42px] items-center justify-center rounded-lg border border-red-200 bg-red-500/90 text-white shadow-sm transition hover:bg-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
        >
          <LeaveIcon className="size-4" />
        </button>
      </div>
    </header>
  );
}

function ConnectionPill({ phase }: { phase: Phase }) {
  const { label, color } = ((): { label: string; color: string } => {
    switch (phase) {
      case "connecting":
        return {
          label: "Connecting",
          color: "bg-amber-100/90 text-amber-800 border-amber-300",
        };
      case "connected":
        return {
          label: "Live",
          color: "bg-emerald-100/90 text-emerald-800 border-emerald-300",
        };
      case "reconnecting":
        return {
          label: "Reconnecting",
          color: "bg-amber-100/90 text-amber-800 border-amber-300",
        };
      case "disconnected":
        return {
          label: "Disconnected",
          color: "bg-red-100/90 text-red-800 border-red-300",
        };
      default:
        return {
          label: phase,
          color: "bg-zinc-200/90 text-zinc-800 border-zinc-300",
        };
    }
  })();
  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium backdrop-blur ${color}`}
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full bg-current"
      />
      {label}
    </span>
  );
}

// ---------- Participant snapshot ----------

interface ParticipantSnapshot {
  identity: string;
  name: string;
  isLocal: boolean;
  hasCameraTrack: boolean;
  hasMicTrack: boolean;
  micMuted: boolean;
  camMuted: boolean;
}

function collectParticipants(room: Room): ParticipantSnapshot[] {
  // Remote participants first (top of the column), local self last (bottom).
  // Classic video-call convention — you see the people you're talking to on
  // top, your own preview below. Requested 2026-09-05: "on the right video
  // part the guest will be on the top."
  const list: ParticipantSnapshot[] = [];
  for (const p of room.remoteParticipants.values()) {
    list.push(snapshotFromParticipant(p, false));
  }
  list.push(snapshotFromParticipant(room.localParticipant, true));
  return list;
}

function snapshotFromParticipant(
  p: Participant,
  isLocal: boolean,
): ParticipantSnapshot {
  const camPub = p.getTrackPublication(Track.Source.Camera);
  const micPub = p.getTrackPublication(Track.Source.Microphone);
  const hasCamera = !!camPub?.track;
  const hasMic = !!micPub?.track;
  return {
    identity: p.identity,
    name: p.name && p.name.length > 0 ? p.name : "Guest",
    isLocal,
    hasCameraTrack: hasCamera,
    hasMicTrack: hasMic,
    // Treat "no track published" as muted for display purposes — either way,
    // there's no audio/video from this participant right now.
    micMuted: !hasMic || !!micPub?.isMuted,
    camMuted: !hasCamera || !!camPub?.isMuted,
  };
}

function findScreenShare(room: Room): ScreenShareInfo | null {
  // Prefer a remote share (the common case — you're watching someone else).
  for (const p of room.remoteParticipants.values()) {
    const pub = p.getTrackPublication(Track.Source.ScreenShare);
    if (pub?.track) {
      return {
        participantIdentity: p.identity,
        isLocal: false,
        videoTrack: pub.track,
      };
    }
  }
  // Local share — the sharer sees their own preview. `attach()` on a
  // LocalVideoTrack only wires up the video MediaStreamTrack (never the
  // ScreenShareAudio track, which is a separate publication), so there's no
  // audio-echo risk.
  const lpShare = room.localParticipant.getTrackPublication(
    Track.Source.ScreenShare,
  );
  if (lpShare?.track) {
    return {
      participantIdentity: room.localParticipant.identity,
      isLocal: true,
      videoTrack: lpShare.track,
    };
  }
  return null;
}

function findParticipantByIdentity(
  room: Room,
  identity: string,
): Participant | null {
  if (room.localParticipant.identity === identity) return room.localParticipant;
  return room.remoteParticipants.get(identity) ?? null;
}

// ---------- Share stage ----------

/**
 * Room-wide background layer. Reads the current scene from `roomState`,
 * falls back to localStorage (per-room key), then to the default. Writes
 * back to localStorage whenever the effective bg changes so re-entering
 * the same room restores the last pick.
 */
function BackgroundLayer({ roomCode }: { roomCode: string }) {
  const { roomState } = useRoomChannel();
  const stored = loadStoredBackground(roomCode);
  const effectiveId =
    roomState.backgroundId ?? stored ?? DEFAULT_BACKGROUND_ID;
  const bg = getBackground(effectiveId);

  useEffect(() => {
    storeBackground(roomCode, effectiveId);
  }, [roomCode, effectiveId]);

  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-[background] duration-500"
        style={{ background: bg.sky }}
      />
      {bg.cloudsOverlay && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: bg.cloudsOverlay }}
        />
      )}
      {bg.foreground && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-40"
          style={{ background: bg.foreground }}
        />
      )}
    </>
  );
}

function ShareStage({
  screenShare,
  startAt,
  participants,
  hostIdentity,
  micEnabled,
  camEnabled,
  onToggleMic,
  onToggleCam,
  localIdentity,
}: {
  screenShare: ScreenShareInfo | null;
  startAt: number | null;
  participants: ParticipantSnapshot[];
  hostIdentity: string | undefined;
  micEnabled: boolean;
  camEnabled: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
  localIdentity: string;
}) {
  const elapsed = useElapsedLabel(startAt);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const { roomState } = useRoomChannel();
  const currentBgId = roomState.backgroundId ?? DEFAULT_BACKGROUND_ID;

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === stageRef.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      void document.exitFullscreen();
    } else {
      void el.requestFullscreen().catch((err) => {
        console.error("[room] fullscreen failed", err);
      });
    }
  }, []);

  return (
    <div
      ref={stageRef}
      className="relative flex min-h-0 flex-1 overflow-hidden rounded-lg bg-transparent"
    >
      {/* Timer pill */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-lg bg-black/40 px-3 py-2 backdrop-blur">
        <span className="font-[family-name:var(--font-outfit)] text-xs tracking-[0.5px] text-zinc-100">
          Together for {elapsed}
        </span>
      </div>

      {/* Top-right pill cluster: scene picker + fullscreen */}
      <div className="absolute right-3 top-3 z-20 flex items-start gap-2">
        <BackgroundPicker currentId={currentBgId} />
        <button
          type="button"
          onClick={toggleFullscreen}
          className="flex items-center gap-2 rounded-lg bg-black/40 px-3 py-2 text-zinc-100 backdrop-blur transition hover:bg-black/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <FullscreenIcon className="size-4" />
          <span className="font-[family-name:var(--font-outfit)] text-xs tracking-[0.5px]">
            {isFullscreen ? "Exit Fullscreen" : "Full Screen"}
          </span>
        </button>
      </div>

      {/* Content — screen share when someone's sharing, otherwise the
          big Figma video wall so the participants are the primary focus. */}
      {screenShare ? (
        <ScreenShareView screenShare={screenShare} />
      ) : (
        <VideoWall
          participants={participants}
          hostIdentity={hostIdentity}
          micEnabled={micEnabled}
          camEnabled={camEnabled}
          onToggleMic={onToggleMic}
          onToggleCam={onToggleCam}
        />
      )}
      {/* Wait-for-Me banner (AC1.1/1.4). Sits above the video, below the
          top pills — same stacking context. */}
      <HoldBanner />
      {/* Live-reaction floaters (AC5.2). Absolute layer inside the stage's
          own stacking context — sits above the video, below the pills. */}
      <ReactionsOverlay />
      {/* Ephemeral chat toasts — recent messages float over the stage so
          conversation is visible without shifting focus to the chat panel. */}
      <ChatNotifications localIdentity={localIdentity} />
    </div>
  );
}

function useElapsedLabel(startAt: number | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startAt === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startAt]);
  if (startAt === null) return "0:00:00";
  const secondsTotal = Math.max(0, Math.floor((now - startAt) / 1000));
  const h = Math.floor(secondsTotal / 3600);
  const m = Math.floor((secondsTotal % 3600) / 60);
  const s = secondsTotal % 60;
  return `${h}:${pad(m)}:${pad(s)}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function ScreenShareView({ screenShare }: { screenShare: ScreenShareInfo }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  useDuckedVolume(videoEl, screenShare.isLocal ? 0 : 1);
  const { roomState } = useRoomChannel();
  // AC1.1: on a remote (guest-side) share, freeze the view while held so
  // the room actually feels stopped even if the sharer hasn't paused their
  // tab yet. Local preview is left running so the sharer can *see* whether
  // they've paused. (See the WaitForMe.tsx module docstring for the full
  // two-part contract.)
  const shouldFreeze = roomState.held !== null && !screenShare.isLocal;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const track = screenShare.videoTrack;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [screenShare.videoTrack]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (shouldFreeze) {
      el.pause();
    } else {
      // `play()` returns a promise that can reject if the user hasn't
      // interacted with the page yet or if the video element was detached
      // mid-frame. We don't act on the rejection — the element will resume
      // on the next frame the SFU delivers.
      void el.play().catch(() => {});
    }
  }, [shouldFreeze]);

  const setRefs = useCallback((el: HTMLVideoElement | null) => {
    ref.current = el;
    setVideoEl(el);
  }, []);

  return (
    <video
      ref={setRefs}
      autoPlay
      playsInline
      // Mute the local preview so the browser can't route ScreenShareAudio
      // back through the sharer's speakers (attach() shouldn't do that, but
      // muted is a cheap belt-and-braces guard).
      muted={screenShare.isLocal}
      // `object-cover` so the shared tab fills the stage edge-to-edge
      // without black letterbox bars (2026-09-05 product ask). Slightly
      // crops the top/bottom (or sides) if the shared content's aspect
      // doesn't match the stage — acceptable trade-off; users can use
      // "Full Screen" to see the untouched aspect.
      className="h-full w-full object-cover"
      aria-label={
        screenShare.isLocal ? "Your shared tab (preview)" : "Shared browser tab"
      }
    />
  );
}

// ---------- Participant column + tiles ----------

function ParticipantColumn({
  participants,
  hostIdentity,
  micEnabled,
  camEnabled,
  onToggleMic,
  onToggleCam,
}: {
  participants: ParticipantSnapshot[];
  hostIdentity: string | undefined;
  micEnabled: boolean;
  camEnabled: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
}) {
  // Only render up to 4 tiles (backend caps at 4). Vertical stack.
  const capped = participants.slice(0, 4);
  return (
    <div className="flex flex-col gap-2">
      {capped.map((p) => (
        <ParticipantTile
          key={p.identity}
          participant={p}
          variant="column"
          isLocalHost={p.isLocal && p.identity === hostIdentity}
          micEnabled={micEnabled}
          camEnabled={camEnabled}
          onToggleMic={onToggleMic}
          onToggleCam={onToggleCam}
        />
      ))}
    </div>
  );
}

/**
 * Big participant tiles filling the stage — used when no one is sharing a
 * screen. Matches the Figma design where the participants' cameras are the
 * primary content until a share starts. Up to 4 tiles side-by-side.
 */
function VideoWall({
  participants,
  hostIdentity,
  micEnabled,
  camEnabled,
  onToggleMic,
  onToggleCam,
}: {
  participants: ParticipantSnapshot[];
  hostIdentity: string | undefined;
  micEnabled: boolean;
  camEnabled: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
}) {
  // FaceTime-style layout — the person you're talking to is the primary
  // subject (fills the stage); your own camera is a small self-PIP in
  // the bottom-right corner so you can sanity-check yourself without
  // ceding half the stage to your own face. Solo state: just my own
  // tile fills the stage. Matches image reference from 2026-09-05
  // (user rejected the previous 2-tile side-by-side layout).
  const local = participants.find((p) => p.isLocal) ?? null;
  const remote = participants.find((p) => !p.isLocal) ?? null;
  const [mirrorOpen, setMirrorOpen] = useState(false);

  // 2-person: remote fills stage, self as PIP overlay bottom-right.
  if (remote && local) {
    return (
      <div className="relative flex min-h-0 flex-1">
        <ParticipantTile
          participant={remote}
          variant="stage"
          isLocalHost={false}
          micEnabled={micEnabled}
          camEnabled={camEnabled}
          onToggleMic={onToggleMic}
          onToggleCam={onToggleCam}
        />
        <div className="group pointer-events-auto absolute bottom-3 right-3 z-20 w-[240px]">
          <ParticipantTile
            participant={local}
            variant="pip"
            isLocalHost={local.identity === hostIdentity}
            micEnabled={micEnabled}
            camEnabled={camEnabled}
            onToggleMic={onToggleMic}
            onToggleCam={onToggleCam}
          />
          <button
            type="button"
            onClick={() => setMirrorOpen(true)}
            aria-label="Open mirror to check how you look"
            className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-[10px] font-medium text-white opacity-0 backdrop-blur transition group-hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <span aria-hidden>🪞</span>
            Check me
          </button>
        </div>
        {mirrorOpen && <SelfMirrorModal onClose={() => setMirrorOpen(false)} />}
      </div>
    );
  }

  // Solo: my own tile fills the stage (Figma node 21:2608). Not 4:3
  // centered — the design shows the self-cam as the primary content
  // filling the entire left column so it feels present rather than a
  // small preview waiting for a guest.
  const only = local ?? remote;
  if (!only) return null;
  return (
    <ParticipantTile
      participant={only}
      variant="stage"
      isLocalHost={only.isLocal && only.identity === hostIdentity}
      micEnabled={micEnabled}
      camEnabled={camEnabled}
      onToggleMic={onToggleMic}
      onToggleCam={onToggleCam}
    />
  );
}

/**
 * Full-screen mirror check — user asked for a "how do I look" preview.
 * Attaches the local camera track to a large mirrored video so the user can
 * inspect themselves without ceding stage real estate. Local-only: nothing
 * broadcast. Esc + backdrop click both dismiss.
 */
function SelfMirrorModal({ onClose }: { onClose: () => void }) {
  const room = useRoom();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!room) return;
    const el = videoRef.current;
    if (!el) return;
    const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
    const track = pub?.track;
    if (!track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [room]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-label="Mirror — how do I look?"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex flex-col items-center gap-3 rounded-2xl bg-white p-4 shadow-2xl"
      >
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="h-[70vh] w-auto rounded-xl bg-zinc-900 object-cover scale-x-[-1]"
          aria-label="Your camera — mirrored"
        />
        <div className="flex w-full items-center justify-between">
          <span className="font-[family-name:var(--font-outfit)] text-xs text-zinc-500">
            Only you see this. Press Esc or click outside to close.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 font-[family-name:var(--font-outfit)] text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ParticipantTile({
  participant,
  isLocalHost,
  micEnabled,
  camEnabled,
  onToggleMic,
  onToggleCam,
  variant = "column",
}: {
  participant: ParticipantSnapshot;
  isLocalHost: boolean;
  micEnabled: boolean;
  camEnabled: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
  /** `column`: small tile in the right sidebar (used while someone is
   *  sharing). `wall`: big tile filling the stage area (used when no one
   *  is sharing — matches the Figma "no-share" layout). `stage`: the
   *  remote participant filling the whole stage in a 2-person call.
   *  `pip`: local self-cam floating overlay in the corner during a
   *  2-person call. Both `stage` and `pip` match Figma node 9:20. */
  variant?: "column" | "wall" | "stage" | "pip";
}) {
  const room = useRoom();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Attach camera track. Re-run when the track subscription changes.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !room) return;
    const p = findParticipantByIdentity(room, participant.identity);
    const pub = p?.getTrackPublication(Track.Source.Camera);
    const track = pub?.track;
    if (!track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [
    room,
    participant.identity,
    participant.camMuted,
    participant.hasCameraTrack,
  ]);

  // Attach mic (remote only — attaching the local mic would echo through the OS).
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !room || participant.isLocal) return;
    const p = findParticipantByIdentity(room, participant.identity);
    const pub = p?.getTrackPublication(Track.Source.Microphone);
    const track = pub?.track;
    if (!track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [
    room,
    participant.identity,
    participant.isLocal,
    participant.micMuted,
    participant.hasMicTrack,
  ]);

  const showVideo = participant.hasCameraTrack && !participant.camMuted;
  const label = participant.isLocal ? "You" : participant.name;

  // Look-at-Me: when a spotlight is active AND this tile belongs to the
  // spotlighted participant, fly the tile to viewport-center and zoom it up
  // so the face really pops above the 60% backdrop. The column below just
  // re-flows into the empty slot for the 4-s duration.
  const spotlight = useSpotlight();
  const spotlighted =
    spotlight.spotlightedIdentity !== null &&
    spotlight.spotlightedIdentity === participant.identity;

  const wall = variant === "wall";
  const stage = variant === "stage";
  const pip = variant === "pip";
  return (
    <div
      // Stop clicks on the spotlighted card from bubbling to the backdrop
      // (which dismisses). Everything else falls through as normal.
      onClick={spotlighted ? (e) => e.stopPropagation() : undefined}
      className={
        spotlighted
          ? // Look-at-Me modal card — Figma node 13:958. 466×319 at
            // rounded-8, translucent white with a white border. Video
            // sits inside with a 6-px inner padding; name and Close
            // live in a footer row below. No glow.
            "fixed left-1/2 top-1/2 z-50 flex h-[319px] w-[466px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 flex-col gap-2 rounded-lg border border-white bg-white/60 p-1.5 shadow-2xl backdrop-blur transition-all duration-500 ease-out"
          : stage
            ? // Big remote-participant tile filling the stage in a 2-person
              // call (Figma node 9:20).
              "relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg"
            : pip
              ? // Self-cam PIP overlay (bottom-left of the stage). 4:3
                // landscape at the chat-panel width so it aligns visually
                // with the right column.
                "flex aspect-[4/3] w-full flex-col gap-1 rounded-lg border border-white bg-white/70 p-1.5 shadow-lg backdrop-blur"
              : wall
                ? "flex aspect-[4/3] h-full min-h-0 min-w-0 max-w-full flex-col gap-1.5 rounded-lg border-2 border-white bg-white/60 p-2 shadow-md backdrop-blur transition-all duration-300"
                : "rounded-lg border border-white bg-white/60 p-1.5 shadow-sm backdrop-blur transition-all duration-300"
      }
    >
      {/* Video preview
          - `spotlighted`: fills the modal card body (flex-1); Figma spec
            uses fixed height 319-px card with a footer, so the video
            grows to fill what's left.
          - `wall`: fills the parent (big stage tile); no fixed height.
          - `column`: default h-[131px] small sidebar tile. */}
      <div
        className={
          "relative flex items-center justify-center overflow-hidden rounded-lg bg-zinc-900 transition-all duration-500 ease-out " +
          (spotlighted
            ? "min-h-0 flex-1 w-full"
            : stage
              ? "min-h-0 flex-1 w-full rounded-lg"
              : wall
                ? "min-h-0 flex-1 w-full"
                : pip
                  ? "min-h-0 flex-1 w-full"
                  : "h-[131px]")
        }
      >
        {showVideo ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={participant.isLocal}
            // Mirror only the LOCAL self-view — that's how every video-chat
            // app you've used works. Raising your right hand appears in the
            // "right" of your own preview so it feels like a mirror. Remote
            // tiles stay unmirrored (that's the peer's real orientation).
            className={
              "h-full w-full object-cover " +
              (participant.isLocal ? "scale-x-[-1]" : "")
            }
            aria-label={`${label} video`}
          />
        ) : (
          <div className="flex flex-col items-center gap-1 text-zinc-500">
            <div
              aria-hidden
              className="flex size-10 items-center justify-center rounded-full bg-zinc-700 text-sm font-medium text-zinc-100"
            >
              {initialOf(participant.name)}
            </div>
            <span className="text-[10px]">camera off</span>
          </div>
        )}

        {/* Hidden audio sink for remote participants. */}
        {!participant.isLocal && <audio ref={audioRef} autoPlay />}

        {/* Remote mic-muted indicator (product ask 2026-09-05: "if my mic is
            off other should be able to see the mic mute on there"). Small
            pill in the top-right corner of the video preview — visible on
            remote tiles only, since the local tile has its own mic toggle
            with the same information already at bottom-right. */}
        {!participant.isLocal && participant.micMuted && (
          <div
            aria-label={`${participant.name}'s mic is muted`}
            className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-md bg-black/60 backdrop-blur"
          >
            <MicOffIcon className="size-3.5 text-red-400" />
          </div>
        )}

        {/* Smart-mic status badge (AC3.3) — local tile only, since the
            state is derived from local audio-graph VAD. */}
        {participant.isLocal && <SmartMicIndicator />}

        {/* Local participant: sparkle badge + inline mic/cam toggles */}
        {participant.isLocal && (
          <>
            <div className="absolute left-1.5 top-1.5 flex size-6 items-center justify-center rounded-xl bg-black/30 backdrop-blur">
              <SparkleIcon className="size-3.5 text-white" />
            </div>
            <div className="absolute bottom-1.5 right-1.5 flex gap-1">
              <button
                type="button"
                onClick={onToggleMic}
                aria-label={micEnabled ? "Mute mic" : "Unmute mic"}
                aria-pressed={micEnabled}
                className="flex size-7 items-center justify-center rounded-md bg-white text-zinc-800 shadow-sm transition hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
              >
                {micEnabled ? (
                  <MicIcon className="size-3.5" />
                ) : (
                  <MicOffIcon className="size-3.5 text-red-600" />
                )}
              </button>
              <button
                type="button"
                onClick={onToggleCam}
                aria-label={camEnabled ? "Turn camera off" : "Turn camera on"}
                aria-pressed={camEnabled}
                className="flex size-7 items-center justify-center rounded-md bg-white text-zinc-800 shadow-sm transition hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
              >
                {camEnabled ? (
                  <VideoIcon className="size-3.5" />
                ) : (
                  <VideoOffIcon className="size-3.5 text-red-600" />
                )}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Footer row — hidden on `stage` variant (Figma has no name label on
          the big remote video). The `pip` variant keeps just the label so
          "You" is still identifiable. */}
      {stage ? null : (
      <div className={"flex items-center justify-between " + (pip ? "px-0.5" : "mt-1 px-1")}>
        <div className={pip ? "px-1" : "p-1"}>
          <span className={"font-[family-name:var(--font-outfit)] text-zinc-900 " + (pip ? "text-[11px]" : "text-xs")}>
            {label}
            {isLocalHost && !pip && (
              <span className="ml-1.5 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-800">
                host
              </span>
            )}
          </span>
        </div>
        {pip ? null : spotlighted ? (
          // Spotlight modal footer — Figma node 13:964. Close pill
          // (64-px wide, 12-px text) + kebab menu.
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={spotlight.dismiss}
              className="flex w-16 items-center justify-center rounded-lg border border-black/10 bg-white px-2 py-1 font-[family-name:var(--font-outfit)] text-xs text-zinc-900 transition hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            >
              Close
            </button>
            <button
              type="button"
              aria-label="Tile menu"
              className="flex size-6 items-center justify-center rounded-md text-zinc-500 hover:bg-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
              title="Non-functional in Phase 1"
            >
              <DragHandleIcon className="size-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            aria-label="Tile menu"
            className="flex size-6 items-center justify-center rounded-md text-zinc-500 hover:bg-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            title="Non-functional in Phase 1"
          >
            <DragHandleIcon className="size-3.5" />
          </button>
        )}
      </div>
      )}
    </div>
  );
}

function initialOf(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "?";
  return trimmed[0]!.toUpperCase();
}

// Chat panel moved to ./Chat.tsx — the mocked bubbles + disabled input are
// replaced by a live implementation over the LiveKit data channel.

// ---------- Action bar ----------

function ActionBar({
  screenSharing,
  currentSharerIdentity,
  screenShareError,
  onToggleScreenShare,
  nickname,
  localIdentity,
}: {
  screenSharing: boolean;
  /** Identity of the current sharer when it's someone other than us.
   *  `null` when nobody is sharing or when we are the sharer. Used to
   *  target the `shareRequest` event so only the actual sharer sees the
   *  "wants to share" toast. */
  currentSharerIdentity: string | null;
  screenShareError: string | null;
  onToggleScreenShare: () => void;
  /** Sender identity carried in reaction payloads (AC5.6 SR announce). */
  nickname: string;
  /** Local participant identity — used by WaitForMePill to distinguish
   *  initiator vs. non-initiator state. */
  localIdentity: string;
}) {
  const someoneElseSharing = currentSharerIdentity !== null;
  const { pending: requestPending, request: requestShare } = useShareRequest(
    currentSharerIdentity,
    nickname,
  );
  const shareLabel = screenSharing
    ? "Stop Screen Share"
    : someoneElseSharing
      ? requestPending
        ? "Requested…"
        : "Request to Share"
      : "Start Screen Share";
  const onShareClick = () => {
    if (screenSharing || !someoneElseSharing) {
      onToggleScreenShare();
      return;
    }
    requestShare();
  };
  const shareDisabled = someoneElseSharing && requestPending;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        {/* Left cluster — feature buttons (Phase 2 wires the behavior) */}
        <div className="flex flex-wrap items-center gap-1">
          <LookAtMePill nickname={nickname} />
          <WhisperTogglePill />
          <button
            type="button"
            onClick={onShareClick}
            disabled={shareDisabled}
            aria-disabled={shareDisabled}
            title={
              someoneElseSharing && !requestPending
                ? "Ask the current sharer to yield."
                : undefined
            }
            className="flex h-[45px] items-center justify-center gap-2 rounded-lg border border-black/10 bg-white px-6 font-[family-name:var(--font-outfit)] text-sm font-medium text-zinc-900 shadow-sm transition hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-white"
          >
            <ShareScreenIcon className="size-4" />
            {shareLabel}
          </button>
        </div>

        {/* Right — reactions (Phase-2 feature 5) */}
        <ReactionsBar nickname={nickname} />
      </div>
      {screenShareError && (
        <p role="alert" className="text-center text-xs text-red-700">
          {screenShareError}
        </p>
      )}
    </div>
  );
}

// ---------- End screen ----------

function RoomEndedScreen({
  title,
  message,
  onHome,
}: {
  title: string;
  message: string;
  onHome: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-6 text-center text-zinc-100">
      <div className="max-w-md rounded-lg border border-zinc-800 bg-zinc-900 p-6 shadow-lg">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-zinc-400">{message}</p>
        <button
          type="button"
          onClick={onHome}
          className="mt-4 inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
        >
          Back home
        </button>
      </div>
    </div>
  );
}
