"use client";

/**
 * Room-channel React provider — the client-side wiring between LiveKit's data
 * channel and the Phase-2 foundation modules. ADR 0005 §1, §2.
 *
 * This is the seam Wave-2 feature specialists plug into. They call
 * `useRoomChannel()` and get:
 *
 *   - `roomState`   — LWW-derived room-wide state (held / whisper /
 *                     cardsEnabled / currentCard). Reactively re-renders on
 *                     change so a feature can bind straight to it.
 *   - `sendEvent`   — encode + `publishData` in one call, with the per-type
 *                     reliability picked from ADR §1's table.
 *   - `subscribe`   — callback API for transient events (reactions, whisper
 *                     voice edges, hello) that don't belong in state.
 *
 * Also handles the snapshot-on-join handshake so a late joiner adopts an
 * existing hold / whisper / cards mode without a race, and derives AC1.3
 * (initiator drop → auto-release) from `ParticipantDisconnected`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import {
  DataPacket_Kind,
  type RemoteParticipant,
  type Room,
  RoomEvent as LKRoomEvent,
} from "livekit-client";
import {
  decodeEvent,
  encodeEvent,
  ENVELOPE_VERSION,
  type RoomEvent,
} from "./envelope";
import {
  adoptSnapshot,
  applyEvent,
  initialRoomState,
  releaseHoldOnDisconnect,
  type RoomState,
} from "./state";

/** Reliability per event type. Mirrors ADR 0005 §1 reliability table. */
function reliabilityFor(event: RoomEvent): DataPacket_Kind {
  if (event.type === "reaction") return DataPacket_Kind.LOSSY;
  if (event.type === "whisper" && event.phase !== "toggle") {
    return DataPacket_Kind.LOSSY;
  }
  return DataPacket_Kind.RELIABLE;
}

/** Delay before we start answering `hello.request` snapshots (ADR §2:
 *  "peer in-room > 500 ms replies"). Prevents everyone answering in unison. */
const SNAPSHOT_ANSWER_MIN_MS = 500;

interface SendOptions {
  /**
   * Optional destination identities. When set, LiveKit sends the packet only
   * to those participants (used for the targeted snapshot reply). Omit for a
   * room-wide broadcast.
   */
  destinationIdentities?: string[];
}

/**
 * Input shape for `sendEvent`. Distributes over `RoomEvent`'s union so the
 * discriminant (`type` / `phase`) still narrows the required payload — a
 * plain `Omit<RoomEvent, "v" | "ts">` would collapse the union and let e.g.
 * `type: "reaction"` be paired with a `whisper.on` field.
 */
type EventInput = RoomEvent extends infer E
  ? E extends RoomEvent
    ? Omit<E, "v" | "ts"> & { ts?: number }
    : never
  : never;

interface RoomChannel {
  roomState: RoomState;
  /** Encode + publish a Phase-2 event. Reliability is auto-picked. */
  sendEvent: (event: EventInput, options?: SendOptions) => Promise<void>;
  /**
   * Subscribe to inbound events. Handler runs after decode + validation
   * but before the reducer applies it. Returns an unsubscribe fn.
   *
   * Use this for transient signals (reactions, voice-on/off, hello) that
   * don't live in `roomState`.
   */
  subscribe: (handler: (event: RoomEvent, from: string) => void) => () => void;
}

const RoomChannelContext = createContext<RoomChannel | null>(null);

interface ProviderProps {
  room: Room | null;
  children: ReactNode;
}

/**
 * Wrap the room UI. `room` may be null while connecting — the provider still
 * mounts so the hook signature stays stable; sends and subscriptions become
 * no-ops until the room is ready.
 */
export function RoomChannelProvider({ room, children }: ProviderProps) {
  const [roomState, dispatch] = useReducer(reducer, undefined, initialStoredState);
  const roomStateRef = useRef(roomState);
  // Keep a ref in sync so async callbacks (e.g. the snapshot reply inside
  // `onDataReceived`) can read the *current* state without re-subscribing on
  // every change. Updated in an effect — mutating the ref during render is a
  // React lint violation and can tear under concurrent rendering.
  useEffect(() => {
    roomStateRef.current = roomState;
  }, [roomState]);

  // Fan-out for transient events (reactions, voice edges, hello). We keep a
  // ref-backed set so subscribing/unsubscribing doesn't force provider
  // re-renders; the reducer path handles state changes on its own.
  const subscribersRef = useRef<Set<(event: RoomEvent, from: string) => void>>(
    new Set(),
  );

  // Track our own join time so we know whether we're eligible to answer
  // hello.request (must have been in-room > 500 ms).
  const joinedAtRef = useRef<number | null>(null);

  const subscribe = useCallback<RoomChannel["subscribe"]>((handler) => {
    subscribersRef.current.add(handler);
    return () => {
      subscribersRef.current.delete(handler);
    };
  }, []);

  const sendEvent = useCallback<RoomChannel["sendEvent"]>(
    async (partial, options) => {
      if (!room) return;
      const full = {
        v: ENVELOPE_VERSION,
        ts: partial.ts ?? Date.now(),
        ...partial,
      } as RoomEvent;
      const bytes = encodeEvent(full);
      try {
        await room.localParticipant.publishData(bytes, {
          reliable: reliabilityFor(full) === DataPacket_Kind.RELIABLE,
          destinationIdentities: options?.destinationIdentities,
        });
      } catch (err) {
        // publishData throws only in edge cases (permission denied by SFU,
        // packet too large). Log — don't propagate; the caller shouldn't
        // have to handle a network glitch on a reaction click.
        console.error("[room-channel] publishData failed", err);
      }
      // Apply locally too so the sender sees their own toggle / hold /
      // dismissal reflected in `roomState` without waiting for the SFU echo
      // (LiveKit doesn't echo the sender's own data packets).
      if (full.type === "hello" && full.phase === "request") return;
      dispatch({ kind: "event", event: full });
      for (const h of subscribersRef.current) h(full, room.localParticipant.identity);
    },
    [room],
  );

  // --- Wire LiveKit listeners ------------------------------------------------
  useEffect(() => {
    if (!room) return;

    const onDataReceived = (
      payload: Uint8Array,
      participant?: RemoteParticipant,
    ) => {
      const event = decodeEvent(payload, (reason) => {
        console.warn("[room-channel] dropped inbound", reason);
      });
      if (event === null) return;
      const from = participant?.identity ?? "";

      // Snapshot handshake: reply to a peer's hello.request iff we've been
      // in-room long enough. Targeted reply, room-scoped identity.
      if (event.type === "hello" && event.phase === "request") {
        const now = Date.now();
        const joinedAt = joinedAtRef.current;
        if (
          joinedAt !== null &&
          now - joinedAt >= SNAPSHOT_ANSWER_MIN_MS &&
          from.length > 0
        ) {
          const snapBgId = roomStateRef.current.backgroundId;
          const snapshotEvent: RoomEvent = {
            v: ENVELOPE_VERSION,
            ts: now,
            type: "hello",
            phase: "snapshot",
            from: room.localParticipant.identity,
            joinedAt,
            held: roomStateRef.current.held,
            whisperOn: roomStateRef.current.whisperOn,
            cardsEnabled: roomStateRef.current.cardsEnabled,
            currentCard: roomStateRef.current.currentCard,
            backgroundId: snapBgId
              ? { id: snapBgId, at: roomStateRef.current.updatedAt.backgroundId }
              : null,
          };
          void room.localParticipant.publishData(encodeEvent(snapshotEvent), {
            reliable: true,
            destinationIdentities: [from],
          });
        }
      }

      // Adopt the first snapshot we accept (dispatch handles the "did we
      // already adopt" gate via a marker in reducer state — see reducer).
      if (event.type === "hello" && event.phase === "snapshot") {
        dispatch({ kind: "snapshot", event, from });
      } else {
        dispatch({ kind: "event", event });
      }
      for (const h of subscribersRef.current) h(event, from);
    };

    const onConnected = () => {
      joinedAtRef.current = Date.now();
      // Broadcast a hello.request so any peer in the room replies with a
      // snapshot of current state. First responder wins (tie-break in the
      // reducer).
      const bytes = encodeEvent({
        v: ENVELOPE_VERSION,
        ts: Date.now(),
        type: "hello",
        phase: "request",
      });
      void room.localParticipant.publishData(bytes, { reliable: true });
    };

    const onParticipantDisconnected = (participant: RemoteParticipant) => {
      dispatch({ kind: "participant-disconnected", identity: participant.identity });
    };

    room.on(LKRoomEvent.DataReceived, onDataReceived);
    room.on(LKRoomEvent.Connected, onConnected);
    room.on(LKRoomEvent.ParticipantDisconnected, onParticipantDisconnected);

    // If we mount while already connected (Strict-mode remount, hot reload),
    // seed joinedAtRef and broadcast hello ourselves.
    if (room.state === "connected") {
      joinedAtRef.current = Date.now();
      const bytes = encodeEvent({
        v: ENVELOPE_VERSION,
        ts: Date.now(),
        type: "hello",
        phase: "request",
      });
      void room.localParticipant.publishData(bytes, { reliable: true });
    }

    return () => {
      room.off(LKRoomEvent.DataReceived, onDataReceived);
      room.off(LKRoomEvent.Connected, onConnected);
      room.off(LKRoomEvent.ParticipantDisconnected, onParticipantDisconnected);
      joinedAtRef.current = null;
    };
  }, [room]);

  const value = useMemo<RoomChannel>(
    () => ({ roomState, sendEvent, subscribe }),
    [roomState, sendEvent, subscribe],
  );

  return (
    <RoomChannelContext.Provider value={value}>
      {children}
    </RoomChannelContext.Provider>
  );
}

/**
 * Access the room channel from any descendant of `RoomChannelProvider`.
 * Throws if used outside the provider so bugs land loud in dev.
 */
export function useRoomChannel(): RoomChannel {
  const ctx = useContext(RoomChannelContext);
  if (ctx === null) {
    throw new Error(
      "useRoomChannel must be called inside a <RoomChannelProvider>",
    );
  }
  return ctx;
}

// ---- Reducer -------------------------------------------------------------

type ReducerAction =
  | { kind: "event"; event: RoomEvent }
  | {
      kind: "snapshot";
      event: Extract<RoomEvent, { type: "hello"; phase: "snapshot" }>;
      from: string;
    }
  | { kind: "participant-disconnected"; identity: string };

interface StoredState extends RoomState {
  /**
   * ADR §2 tie-break marker for the snapshot handshake. We adopt the first
   * accepted snapshot; a later one from a peer with an earlier joinedAt (or
   * lex-smaller identity on tie) supersedes only if we haven't already
   * committed real events over it. `null` until we adopt once.
   */
  snapshotFrom: { identity: string; joinedAt: number } | null;
}

function initialStoredState(): StoredState {
  return { ...initialRoomState(), snapshotFrom: null };
}

function reducer(state: StoredState, action: ReducerAction): StoredState {
  switch (action.kind) {
    case "event":
      return { ...state, ...applyEvent(state, action.event) };

    case "snapshot": {
      // Only adopt if we haven't yet, or if this responder joined earlier
      // (or has a lex-smaller identity on tie) than the one we adopted from.
      const incoming = { identity: action.from, joinedAt: action.event.joinedAt };
      if (state.snapshotFrom !== null) {
        const cur = state.snapshotFrom;
        const incomingIsBetter =
          incoming.joinedAt < cur.joinedAt ||
          (incoming.joinedAt === cur.joinedAt && incoming.identity < cur.identity);
        if (!incomingIsBetter) return state;
      }
      const merged = adoptSnapshot(state, action.event);
      return { ...state, ...merged, snapshotFrom: incoming };
    }

    case "participant-disconnected": {
      const merged = releaseHoldOnDisconnect(state, action.identity);
      if (merged === state) return state;
      return { ...state, ...merged };
    }
  }
}
