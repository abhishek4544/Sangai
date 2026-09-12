"use client";

/**
 * useWatchSync — Watch Mode synchronisation hook. ADR 0006.
 *
 * Owns the full Watch Mode state machine for the local participant:
 *
 *   - Subscribes to inbound watch/* events via useRoomChannel().subscribe().
 *   - Publishes outbound events via useRoomChannel().sendEvent().
 *   - Applies LWW (last-writer-wins) arbitration on updatedAt.
 *   - Enforces H2 skew cap via isWatchEventFresh().
 *   - Derives controllerId from the LiveKit transport sender arg (M3).
 *   - Suppresses own-echo (events we published are reflected back).
 *   - Broadcasts heartbeat every 3 s while playing + local controller.
 *   - Applies drift correction on inbound heartbeat (|diff| > 1.5 s → seek).
 *   - Implements a local leaky-bucket rate limiter at 10 events/sec (ADR 0006).
 *   - Bootstraps late-joiner state from hello.snapshot.watchState.
 *
 * Does NOT reach into LiveKit directly. All sends go through sendEvent(),
 * all receives through subscribe(). Same pattern as WaitForMe, Chat, etc.
 */

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type RefObject,
} from "react";
import { useRoomChannel } from "@/lib/room/use-room-channel";
import type { RoomEvent } from "@/lib/room/envelope";
import { isWatchEventFresh } from "@/lib/watch/validate-url";
import type { PlayerEvent, ProviderPlayerHandle } from "@/lib/watch/providers/types";

// ---- Constants -----------------------------------------------------------

/** Drift threshold: if |local - remote| > this, seek to correct. */
const DRIFT_THRESHOLD_SEC = 1.5;
/** Heartbeat cadence while playing and local participant is the controller. */
const HEARTBEAT_INTERVAL_MS = 3_000;
/** Max-events-per-second rate limit across all watch/* publish calls. */
const RATE_LIMIT_PER_SEC = 10;

// ---- Rate limiter (leaky bucket at 10 events/sec) -----------------------

/**
 * Simple leaky-bucket rate limiter. Tracks timestamps of the last N sends
 * inside a 1-second window; denies a new send if the capacity is exhausted.
 *
 * Extracted as a pure class so it's unit-testable without React.
 */
export class WatchRateLimiter {
  private readonly capacity = RATE_LIMIT_PER_SEC;
  private readonly windowMs = 1_000;
  private stamps: number[] = [];

  /** Returns true if the send is allowed (and records it); false if rate-limited. */
  tryAcquire(now: number = Date.now()): boolean {
    // Remove timestamps outside the current window.
    this.stamps = this.stamps.filter((t) => now - t < this.windowMs);
    if (this.stamps.length >= this.capacity) return false;
    this.stamps.push(now);
    return true;
  }

  /** Test-only: reset state. */
  reset() {
    this.stamps = [];
  }
}

// ---- WatchState (local replica of room-wide playback state) -------------

export type WatchSyncState =
  | { status: "idle" }
  | {
      status: "active";
      providerId: "youtube";
      mediaId: string;
      playbackState: "playing" | "paused";
      positionSec: number;
      updatedAt: number;
      /** LiveKit participant identity of the last actor (from transport, not payload). */
      controllerId: string;
    };

// ---- Reducer -------------------------------------------------------------

type WatchAction =
  | {
      kind: "load";
      providerId: "youtube";
      mediaId: string;
      positionSec: number;
      updatedAt: number;
      controllerId: string;
    }
  | {
      kind: "play";
      positionSec: number;
      updatedAt: number;
      controllerId: string;
    }
  | {
      kind: "pause";
      positionSec: number;
      updatedAt: number;
      controllerId: string;
    }
  | {
      kind: "seek";
      positionSec: number;
      updatedAt: number;
      controllerId: string;
    }
  | { kind: "stop"; updatedAt: number }
  | {
      kind: "snapshot";
      providerId: "youtube";
      mediaId: string;
      playbackState: "playing" | "paused";
      positionSec: number;
      updatedAt: number;
    };

/**
 * Pure reducer — extracted so it's testable without React.
 *
 * LWW arbitration: events with updatedAt <= current state's updatedAt are
 * dropped. watch/stop always clears — don't let a high-ts load prevent a stop.
 */
export function watchReducer(
  state: WatchSyncState,
  action: WatchAction,
): WatchSyncState {
  switch (action.kind) {
    case "load": {
      const currentUpdatedAt = state.status === "active" ? state.updatedAt : 0;
      if (action.updatedAt <= currentUpdatedAt) return state;
      return {
        status: "active",
        providerId: action.providerId,
        mediaId: action.mediaId,
        playbackState: "paused",
        positionSec: action.positionSec,
        updatedAt: action.updatedAt,
        controllerId: action.controllerId,
      };
    }

    case "play": {
      if (state.status !== "active") return state;
      if (action.updatedAt <= state.updatedAt) return state;
      return {
        ...state,
        playbackState: "playing",
        positionSec: action.positionSec,
        updatedAt: action.updatedAt,
        controllerId: action.controllerId,
      };
    }

    case "pause": {
      if (state.status !== "active") return state;
      if (action.updatedAt <= state.updatedAt) return state;
      return {
        ...state,
        playbackState: "paused",
        positionSec: action.positionSec,
        updatedAt: action.updatedAt,
        controllerId: action.controllerId,
      };
    }

    case "seek": {
      if (state.status !== "active") return state;
      if (action.updatedAt <= state.updatedAt) return state;
      return {
        ...state,
        positionSec: action.positionSec,
        updatedAt: action.updatedAt,
        controllerId: action.controllerId,
      };
    }

    case "stop":
      // Stop always clears regardless of timestamp.
      return { status: "idle" };

    case "snapshot": {
      // Only adopt snapshot when idle — don't clobber real events.
      if (state.status !== "idle") return state;
      return {
        status: "active",
        providerId: action.providerId,
        mediaId: action.mediaId,
        playbackState: action.playbackState,
        positionSec: action.positionSec,
        updatedAt: action.updatedAt,
        controllerId: "",
      };
    }
  }
}

// ---- Hook ----------------------------------------------------------------

interface UseWatchSyncReturn {
  watchState: WatchSyncState;
  /** Publish watch/load and update local state. Call when submitting a URL. */
  publishLoad(providerId: "youtube", mediaId: string): void;
  /** Publish watch/stop and clear local state. Any participant can call this. */
  publishStop(): void;
  /**
   * Ref to the mounted provider's imperative handle.
   * Pass as `handleRef` to the Provider.Component.
   */
  playerRef: RefObject<ProviderPlayerHandle | null>;
  /**
   * Callback for PlayerEvents from the provider component.
   * Pass as `onEvent` to the Provider.Component.
   */
  onPlayerEvent: (event: PlayerEvent) => void;
}

export function useWatchSync(): UseWatchSyncReturn {
  const { sendEvent, subscribe } = useRoomChannel();
  const [watchState, dispatch] = useReducer(watchReducer, { status: "idle" });

  // Stable ref to watchState for async callbacks.
  const watchStateRef = useRef<WatchSyncState>(watchState);
  useEffect(() => {
    watchStateRef.current = watchState;
  }, [watchState]);

  // Imperative handle to the mounted provider player.
  const playerRef = useRef<ProviderPlayerHandle | null>(null);

  // Rate limiter — stable across renders.
  const rateLimiterRef = useRef(new WatchRateLimiter());

  // Own-echo suppression: track the last updatedAt we published locally.
  // On receive we compare the event's updatedAt to this; if they match the
  // event is our own echo and we skip the apply step.
  const lastPublishedUpdatedAtRef = useRef<number>(0);

  // Heartbeat interval ref — cleared when not playing or not the controller.
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- Heartbeat management ---------------------------------------------

  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current !== null) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    stopHeartbeat();
    heartbeatIntervalRef.current = setInterval(() => {
      const state = watchStateRef.current;
      if (state.status !== "active" || state.playbackState !== "playing") {
        stopHeartbeat();
        return;
      }
      // Only send if we are the current controller (we published the last event).
      if (state.updatedAt !== lastPublishedUpdatedAtRef.current) return;
      if (!rateLimiterRef.current.tryAcquire()) return;
      const positionSec = playerRef.current?.getPositionSec() ?? state.positionSec;
      const updatedAt = Date.now();
      void sendEvent({
        type: "watch/heartbeat",
        positionSec,
        updatedAt,
      } as Extract<RoomEvent, { type: "watch/heartbeat" }>);
    }, HEARTBEAT_INTERVAL_MS);
  }, [sendEvent, stopHeartbeat]);

  // ---- Inbound event handler --------------------------------------------

  useEffect(() => {
    const unsubscribe = subscribe((event: RoomEvent, from: string) => {
      // Own-echo suppression: drop events whose updatedAt matches our last publish.
      if (
        "updatedAt" in event &&
        typeof (event as { updatedAt?: unknown }).updatedAt === "number" &&
        (event as { updatedAt: number }).updatedAt === lastPublishedUpdatedAtRef.current
      ) {
        return;
      }

      // H2 layer-2 runtime skew cap: drop events from the future (> 5 min ahead).
      if (
        "updatedAt" in event &&
        typeof (event as { updatedAt?: unknown }).updatedAt === "number" &&
        !isWatchEventFresh({ updatedAt: (event as { updatedAt: number }).updatedAt })
      ) {
        return;
      }

      // M3: controllerId is always the LiveKit transport sender identity, never
      // a self-reported payload field. `from` comes from the DataReceived participant arg.
      const transportSenderId = from;

      switch (event.type) {
        case "watch/load": {
          dispatch({
            kind: "load",
            providerId: event.providerId,
            mediaId: event.mediaId,
            positionSec: event.positionSec,
            updatedAt: event.updatedAt,
            controllerId: transportSenderId,
          });
          break;
        }

        case "watch/play": {
          const currentState = watchStateRef.current;
          const willApply =
            currentState.status === "active" &&
            event.updatedAt > currentState.updatedAt;
          dispatch({
            kind: "play",
            positionSec: event.positionSec,
            updatedAt: event.updatedAt,
            controllerId: transportSenderId,
          });
          if (willApply) {
            playerRef.current?.play();
          }
          break;
        }

        case "watch/pause": {
          const currentState = watchStateRef.current;
          const willApply =
            currentState.status === "active" &&
            event.updatedAt > currentState.updatedAt;
          dispatch({
            kind: "pause",
            positionSec: event.positionSec,
            updatedAt: event.updatedAt,
            controllerId: transportSenderId,
          });
          if (willApply) {
            playerRef.current?.pause();
          }
          break;
        }

        case "watch/seek": {
          const currentState = watchStateRef.current;
          const willApply =
            currentState.status === "active" &&
            event.updatedAt > currentState.updatedAt;
          dispatch({
            kind: "seek",
            positionSec: event.positionSec,
            updatedAt: event.updatedAt,
            controllerId: transportSenderId,
          });
          if (willApply) {
            playerRef.current?.seekTo(event.positionSec);
          }
          break;
        }

        case "watch/heartbeat": {
          // Drift correction: if |local - remote compensated| > 1.5 s, seek.
          // Note: only the controller sends heartbeats; non-controllers apply them.
          // Since we already do own-echo suppression above, any heartbeat reaching
          // this code path is from a remote peer.
          const localPos = playerRef.current?.getPositionSec() ?? 0;
          const ageSec = (Date.now() - event.updatedAt) / 1_000;
          const remotePos = event.positionSec + Math.max(0, ageSec);
          const diff = Math.abs(localPos - remotePos);
          // Boundary: spec says "> 1.5 s"; we use strict greater-than.
          // At exactly 1.5 s we do NOT seek (boundary is implementation-defined
          // per the spec; we document it here).
          if (diff > DRIFT_THRESHOLD_SEC) {
            playerRef.current?.seekTo(remotePos);
          }
          break;
        }

        case "watch/stop": {
          dispatch({ kind: "stop", updatedAt: event.updatedAt });
          stopHeartbeat();
          break;
        }

        case "hello": {
          if (event.phase !== "snapshot") break;
          // Late-joiner resync: if the snapshot carries watchState, apply it.
          // The watchState field is optional (pre-v1.1 peers omit it).
          const snapEvent = event as typeof event & {
            watchState?: {
              providerId: "youtube";
              mediaId: string;
              playbackState: "playing" | "paused";
              positionSec: number;
              updatedAt: number;
            };
          };
          const ws = snapEvent.watchState;
          if (!ws) break;
          // Only adopt when idle — real events take priority.
          if (watchStateRef.current.status !== "idle") break;
          // Compensate for the time the snapshot was in flight.
          const ageSec = (Date.now() - ws.updatedAt) / 1_000;
          const correctedPos = ws.positionSec + Math.max(0, ageSec);
          dispatch({
            kind: "snapshot",
            providerId: ws.providerId,
            mediaId: ws.mediaId,
            playbackState: ws.playbackState,
            positionSec: correctedPos,
            updatedAt: ws.updatedAt,
          });
          // The provider component will mount next render; onPlayerEvent("ready")
          // picks up the snapshot state and calls seekTo + play/pause.
          break;
        }

        default:
          break;
      }
    });
    return unsubscribe;
  }, [subscribe, stopHeartbeat]);

  // ---- Heartbeat lifecycle: start/stop when playback state changes ------

  useEffect(() => {
    if (watchState.status !== "active" || watchState.playbackState !== "playing") {
      stopHeartbeat();
      return;
    }
    // Only start the heartbeat if we are the controller (we published this state).
    if (watchState.updatedAt === lastPublishedUpdatedAtRef.current) {
      startHeartbeat();
    } else {
      stopHeartbeat();
    }
  }, [watchState, startHeartbeat, stopHeartbeat]);

  // Cleanup on unmount.
  useEffect(() => () => stopHeartbeat(), [stopHeartbeat]);

  // ---- Publish helpers --------------------------------------------------

  const publishLoad = useCallback(
    (providerId: "youtube", mediaId: string) => {
      if (!rateLimiterRef.current.tryAcquire()) return;
      const updatedAt = Date.now();
      lastPublishedUpdatedAtRef.current = updatedAt;
      dispatch({
        kind: "load",
        providerId,
        mediaId,
        positionSec: 0,
        updatedAt,
        controllerId: "local",
      });
      void sendEvent({
        type: "watch/load",
        providerId,
        mediaId,
        positionSec: 0,
        updatedAt,
      } as Extract<RoomEvent, { type: "watch/load" }>);
    },
    [sendEvent],
  );

  const publishStop = useCallback(() => {
    stopHeartbeat();
    const updatedAt = Date.now();
    lastPublishedUpdatedAtRef.current = updatedAt;
    dispatch({ kind: "stop", updatedAt });
    if (!rateLimiterRef.current.tryAcquire()) return;
    void sendEvent({
      type: "watch/stop",
      updatedAt,
    } as Extract<RoomEvent, { type: "watch/stop" }>);
  }, [sendEvent, stopHeartbeat]);

  // ---- Player event handler (from the provider component) ---------------

  const onPlayerEvent = useCallback(
    (playerEvent: PlayerEvent) => {
      switch (playerEvent.type) {
        case "ready": {
          // Late-joiner recovery: seek to snapshot position and apply play/pause.
          const state = watchStateRef.current;
          if (state.status === "active") {
            playerRef.current?.seekTo(state.positionSec);
            if (state.playbackState === "playing") {
              playerRef.current?.play();
            }
          }
          break;
        }

        case "play": {
          if (!rateLimiterRef.current.tryAcquire()) break;
          const updatedAt = Date.now();
          lastPublishedUpdatedAtRef.current = updatedAt;
          dispatch({
            kind: "play",
            positionSec: playerEvent.positionSec,
            updatedAt,
            controllerId: "local",
          });
          void sendEvent({
            type: "watch/play",
            positionSec: playerEvent.positionSec,
            updatedAt,
          } as Extract<RoomEvent, { type: "watch/play" }>);
          break;
        }

        case "pause": {
          if (!rateLimiterRef.current.tryAcquire()) break;
          const updatedAt = Date.now();
          lastPublishedUpdatedAtRef.current = updatedAt;
          dispatch({
            kind: "pause",
            positionSec: playerEvent.positionSec,
            updatedAt,
            controllerId: "local",
          });
          void sendEvent({
            type: "watch/pause",
            positionSec: playerEvent.positionSec,
            updatedAt,
          } as Extract<RoomEvent, { type: "watch/pause" }>);
          break;
        }

        case "seek": {
          if (!rateLimiterRef.current.tryAcquire()) break;
          const updatedAt = Date.now();
          lastPublishedUpdatedAtRef.current = updatedAt;
          dispatch({
            kind: "seek",
            positionSec: playerEvent.positionSec,
            updatedAt,
            controllerId: "local",
          });
          void sendEvent({
            type: "watch/seek",
            positionSec: playerEvent.positionSec,
            updatedAt,
          } as Extract<RoomEvent, { type: "watch/seek" }>);
          break;
        }

        case "error":
          // Error events are component-local; do not publish to the channel.
          // WatchPanel listens to the provider's onEvent prop directly.
          break;
      }
    },
    [sendEvent],
  );

  return { watchState, publishLoad, publishStop, playerRef, onPlayerEvent };
}
