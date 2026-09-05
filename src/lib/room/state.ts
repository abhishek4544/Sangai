/**
 * Room-wide state — event-sourced, last-writer-wins by `ts`. ADR 0005 §2.
 *
 * Every client keeps a local replica derived from `RoomEvent`s on the data
 * channel. There is no server-side authority. When two events touch the same
 * field, the later `ts` wins; if `ts` ties, we keep the incumbent (arbitrary
 * but deterministic — real ties across two devices are effectively never).
 *
 * Reconnecting clients bootstrap via the `hello` handshake in `envelope.ts`:
 * broadcast `hello.request`, adopt the first `hello.snapshot` reply (earliest
 * `joinedAt` — the peer who's been in the room longest — with lexicographic
 * identity as tie-break).
 *
 * AC1.3 (initiator-drop auto-release ≤ 5s) is a client-side derivation on
 * `RoomEvent.ParticipantDisconnected`: if the departing identity is the
 * current `held.by`, every peer independently clears the hold. Symmetric,
 * no timer, no broadcast — every peer sees the same signal.
 */

import type { HelloEvent, RoomEvent } from "./envelope";

export interface HeldState {
  by: string;
  byName?: string;
  at: number;
}

export interface CurrentCard {
  id: string;
  at: number;
}

export interface RoomState {
  held: HeldState | null;
  whisperOn: boolean;
  cardsEnabled: boolean;
  currentCard: CurrentCard | null;
  /** TICKET-3: id from `src/lib/backgrounds.ts` (BACKGROUNDS[].id). Unknown
   *  ids fall back to the default at render time in `getBackground()`. */
  backgroundId: string | null;
  /** Which couple-game is open in the right-column panel. `null` = the tile
   *  grid is showing (back to selection). id refers to `GAMES[].id`. */
  activeGameId: string | null;
  /** Identity of the peer who opened the active game. Some games (Movie
   *  Picker) restrict certain steps to the opener. `null` when no game
   *  active or when opened by a pre-`by`-field peer. */
  activeGameBy: string | null;
  /**
   * Per-field last-writer timestamps. We can't derive these from the values
   * (`held: null` on init and `held: null` after release look the same), so
   * we track them explicitly so a stale late-arriving event can't override
   * a newer one.
   */
  updatedAt: {
    held: number;
    whisperOn: number;
    cardsEnabled: number;
    currentCard: number;
    backgroundId: number;
    activeGameId: number;
  };
}

/**
 * Initial state at room-connect time. Matches the "empty room" case — cards
 * default ON per AC6.5.
 */
export function initialRoomState(): RoomState {
  return {
    held: null,
    whisperOn: false,
    cardsEnabled: true,
    currentCard: null,
    backgroundId: null,
    activeGameId: null,
    activeGameBy: null,
    updatedAt: {
      held: 0,
      whisperOn: 0,
      cardsEnabled: 0,
      currentCard: 0,
      backgroundId: 0,
      activeGameId: 0,
    },
  };
}

/**
 * Apply one inbound event. Pure function — returns a new state, never
 * mutates. Events with `ts` older than the field's last-writer are ignored
 * (LWW). Events that don't affect room-wide state (reactions, whisper VAD
 * edges, hello request) return the input state unchanged.
 */
export function applyEvent(state: RoomState, event: RoomEvent): RoomState {
  switch (event.type) {
    case "reaction":
      // Reactions are transient — not room-wide state, rendered inline by
      // the reactions overlay. Reducer is a no-op.
      return state;

    case "hold": {
      if (event.ts <= state.updatedAt.held) return state;
      const nextHeld: HeldState | null = event.held
        ? { by: event.by ?? "", byName: event.byName, at: event.ts }
        : null;
      return {
        ...state,
        held: nextHeld,
        updatedAt: { ...state.updatedAt, held: event.ts },
      };
    }

    case "whisper": {
      if (event.phase === "toggle") {
        if (event.ts <= state.updatedAt.whisperOn) return state;
        return {
          ...state,
          whisperOn: event.on,
          updatedAt: { ...state.updatedAt, whisperOn: event.ts },
        };
      }
      // voice-on / voice-off are per-participant VAD edges. They drive the
      // audio-graph duck locally (§4) but aren't room-wide state.
      return state;
    }

    case "card": {
      if (event.phase === "toggle") {
        if (event.ts <= state.updatedAt.cardsEnabled) return state;
        // AC6.5: turning off dismisses any visible card immediately.
        const clearing = !event.on;
        return {
          ...state,
          cardsEnabled: event.on,
          currentCard: clearing ? null : state.currentCard,
          updatedAt: {
            ...state.updatedAt,
            cardsEnabled: event.ts,
            currentCard: clearing ? event.ts : state.updatedAt.currentCard,
          },
        };
      }
      if (event.phase === "propose") {
        if (event.ts <= state.updatedAt.currentCard) return state;
        // A proposal is silently ignored when cards are toggled off — the
        // sender may have raced with a `card.toggle:false` from another peer.
        if (!state.cardsEnabled) return state;
        return {
          ...state,
          currentCard: { id: event.id, at: event.ts },
          updatedAt: { ...state.updatedAt, currentCard: event.ts },
        };
      }
      // dismiss: first click wins (AC6.3). Only clears if it matches the
      // currently-visible card — a late dismiss for an older card is a no-op
      // so it doesn't wipe out a card that arrived in the meantime.
      if (event.ts <= state.updatedAt.currentCard) return state;
      if (state.currentCard === null || state.currentCard.id !== event.id) {
        return state;
      }
      return {
        ...state,
        currentCard: null,
        updatedAt: { ...state.updatedAt, currentCard: event.ts },
      };
    }

    case "hello":
      // Handshake events do not mutate state via the reducer — the joiner
      // adopts a full snapshot in one shot; see `adoptSnapshot`.
      return state;

    case "shareRequest":
      // Transient — surfaced to the current sharer as a toast, no room
      // state to track. The sharer's LiveKit track publish/unpublish is
      // already the source of truth for "who is sharing".
      return state;

    case "lookAtMe":
      // Transient spotlight — surfaced as a 4-s dim overlay on receipt,
      // no room state to track.
      return state;

    case "chat":
      // Message history lives in the ChatPanel's local state (per-tab, no
      // persistence). Room-state reducer is a no-op.
      return state;

    case "background": {
      // Single phase (`pick`). LWW by ts.
      if (event.ts <= state.updatedAt.backgroundId) return state;
      return {
        ...state,
        backgroundId: event.id,
        updatedAt: { ...state.updatedAt, backgroundId: event.ts },
      };
    }

    case "game": {
      if (event.ts <= state.updatedAt.activeGameId) return state;
      const nextId = event.phase === "open" ? event.id : null;
      const nextBy = event.phase === "open" ? event.by ?? null : null;
      return {
        ...state,
        activeGameId: nextId,
        activeGameBy: nextBy,
        updatedAt: { ...state.updatedAt, activeGameId: event.ts },
      };
    }

    case "truthOrDare":
    case "draw":
    case "moviePicker":
    case "movieTrivia":
      // Per-game events flow only through the subscribe path. Reducer is
      // a no-op — game state lives inside the game component, not room state.
      return state;
  }
}

/**
 * Merge a snapshot into current state. Called by the joiner on the first
 * `hello.snapshot` it accepts (per ADR §2 tie-breaking — pick the responder
 * with the earliest `joinedAt`, lexicographic identity to break ties).
 *
 * Each field takes the snapshot's value only if the snapshot's per-field
 * timestamp is newer than what we already have. That way a late-arriving
 * snapshot can't clobber events we saw between broadcasting `hello.request`
 * and receiving the reply.
 */
export function adoptSnapshot(
  state: RoomState,
  snap: Extract<HelloEvent, { phase: "snapshot" }>,
): RoomState {
  const heldTs = snap.held?.at ?? 0;
  const cardTs = snap.currentCard?.at ?? 0;
  const next: RoomState = { ...state, updatedAt: { ...state.updatedAt } };

  if (heldTs > state.updatedAt.held) {
    next.held = snap.held ? { ...snap.held } : null;
    next.updatedAt.held = heldTs;
  }
  // whisperOn / cardsEnabled don't carry per-field timestamps in the
  // snapshot — the responder ships a value, not a history. We take them
  // only if we haven't seen any updates yet (updatedAt === 0) so a snapshot
  // that arrives after a real event can't downgrade the truth.
  if (state.updatedAt.whisperOn === 0) {
    next.whisperOn = snap.whisperOn;
    next.updatedAt.whisperOn = snap.ts;
  }
  if (state.updatedAt.cardsEnabled === 0) {
    next.cardsEnabled = snap.cardsEnabled;
    next.updatedAt.cardsEnabled = snap.ts;
  }
  if (cardTs > state.updatedAt.currentCard) {
    next.currentCard = snap.currentCard ? { ...snap.currentCard } : null;
    next.updatedAt.currentCard = cardTs;
  }
  // TICKET-3: bg is optional in the snapshot for forward-compat with older
  // peers who don't send the field. Same LWW rule as the other refs.
  const bgTs = snap.backgroundId?.at ?? 0;
  if (bgTs > state.updatedAt.backgroundId) {
    next.backgroundId = snap.backgroundId?.id ?? null;
    next.updatedAt.backgroundId = bgTs;
  }
  const gameTs = snap.activeGame?.at ?? 0;
  if (gameTs > state.updatedAt.activeGameId) {
    next.activeGameId = snap.activeGame?.id ?? null;
    // Snapshot doesn't carry `by` today — leave activeGameBy as-is; the
    // owner-gate falls open (nobody), which is safe: worst case picker's
    // genre step becomes editable by both for a joiner. Follow-up ticket
    // can extend `hello.snapshot` if this becomes visible.
    next.updatedAt.activeGameId = gameTs;
  }
  return next;
}

/**
 * AC1.3 hook — call when a participant disconnects. If the departing identity
 * is the current hold's initiator, clear the hold locally. Symmetric
 * derivation on every peer.
 *
 * The `at` timestamp on the auto-release matches the last hold event's `at`
 * so a stale `hold: true` from the initiator (in flight when they dropped)
 * doesn't come back after we release.
 */
export function releaseHoldOnDisconnect(
  state: RoomState,
  identity: string,
): RoomState {
  if (state.held === null || state.held.by !== identity) return state;
  return {
    ...state,
    held: null,
    // Don't bump the timestamp — clearing on disconnect is a *derivation*
    // from the last-known state, not a new event. If the initiator's own
    // `hold: false` release lands afterward, the guard on ts still holds.
    updatedAt: { ...state.updatedAt },
  };
}
