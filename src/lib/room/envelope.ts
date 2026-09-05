/**
 * Phase-2 data-channel envelope. ADR 0005 §1.
 *
 * Wire format: JSON-encoded UTF-8 bytes.
 *
 *     { v: 1, ts: <unix-ms of sender>, type: "reaction" | ..., ...payload }
 *
 * - `v` is the envelope version. Peers on a different `v` drop silently
 *   (forward compat — old clients don't try to interpret new shapes).
 * - `ts` is the sender-side unix-ms. It's the last-writer-wins arbiter for
 *   room-wide state (see `state.ts`). Never trust it for wall-clock ordering.
 * - Unknown `type`s are dropped silently — same posture.
 *
 * Every inbound message is Zod-parsed before dispatch; malformed input logs
 * once and drops. Matches ADR 0004's route-validation posture.
 */

import { z } from "zod";

export const ENVELOPE_VERSION = 1;

// ---- Payload shapes ------------------------------------------------------

/** AC5.1 — a single reaction fires with an emoji, a sender-visible name, and
 *  a stable id so the receiver can dedupe if the LOSSY channel duplicates. */
const ReactionSchema = z.object({
  v: z.literal(ENVELOPE_VERSION),
  ts: z.number().int().nonnegative(),
  type: z.literal("reaction"),
  emoji: z.string().min(1).max(8),
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
});

/** AC1.x — hold state is single-writer-wins by `ts`. Payload carries the
 *  next-state, not a delta: `held=true` with initiator identity + display
 *  name; `held=false` to release. Peers derive the banner from state. */
const HoldSchema = z.object({
  v: z.literal(ENVELOPE_VERSION),
  ts: z.number().int().nonnegative(),
  type: z.literal("hold"),
  held: z.boolean(),
  by: z.string().min(1).max(128).optional(),
  byName: z.string().min(1).max(64).optional(),
});

/** AC4.x — whisper has two shapes on the same channel:
 *  - `toggle`: room-wide on/off. RELIABLE (see ADR §1 reliability table).
 *  - `voice-on` / `voice-off`: local VAD edges, broadcast so peers duck in
 *    sync. LOSSY; a missed edge self-heals on the next one. */
const WhisperSchema = z.discriminatedUnion("phase", [
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("whisper"),
    phase: z.literal("toggle"),
    on: z.boolean(),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("whisper"),
    phase: z.literal("voice-on"),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("whisper"),
    phase: z.literal("voice-off"),
  }),
]);

/** AC6.x — cards. `propose` is the room-wide LWW event; `dismiss` clears
 *  the current card; `toggle` sets the feature on/off room-wide. */
const CardSchema = z.discriminatedUnion("phase", [
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("card"),
    phase: z.literal("propose"),
    id: z.string().min(1).max(64),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("card"),
    phase: z.literal("dismiss"),
    id: z.string().min(1).max(64),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("card"),
    phase: z.literal("toggle"),
    on: z.boolean(),
  }),
]);

/** Product ask 2026-09-05: when someone else is sharing, another participant
 *  can *ask* for the spot instead of being passively blocked. Targeted
 *  (not broadcast) — `destinationIdentities` is set to the current sharer
 *  at send time, so uninvolved participants don't see the toast. Payload
 *  carries the requester's display name; the requester's identity comes
 *  through the LiveKit `DataReceived` participant argument. RELIABLE —
 *  a lost request feels like a broken button. */
/** Chat message (product ask 2026-09-05). Broadcast (no `destinationIdentities`),
 *  RELIABLE — a lost message reads as a broken feature. Text is capped at
 *  500 chars server-side so an oversized payload can't flood the channel;
 *  the client-side input caps at the same limit. Sender name inline for
 *  rendering; identity comes via the `DataReceived` participant arg. */
const ChatSchema = z.object({
  v: z.literal(ENVELOPE_VERSION),
  ts: z.number().int().nonnegative(),
  type: z.literal("chat"),
  text: z.string().min(1).max(500),
  name: z.string().min(1).max(64),
});

/** "Look at Me" — sender broadcasts, every peer dims their UI except the
 *  sender's participant tile, ~4 s auto-clear. Product ask 2026-09-05.
 *  Broadcast (no `destinationIdentities`), RELIABLE. Payload carries the
 *  sender's name for the spotlight label; identity comes via the
 *  `DataReceived` participant arg. */
const LookAtMeSchema = z.object({
  v: z.literal(ENVELOPE_VERSION),
  ts: z.number().int().nonnegative(),
  type: z.literal("lookAtMe"),
  name: z.string().min(1).max(64),
});

const ShareRequestSchema = z.object({
  v: z.literal(ENVELOPE_VERSION),
  ts: z.number().int().nonnegative(),
  type: z.literal("shareRequest"),
  name: z.string().min(1).max(64),
});

/** ADR §2 snapshot-on-join handshake.
 *  - `request`: joiner broadcasts on `RoomEvent.Connected`.
 *  - `snapshot`: peers > 500 ms in-room reply via targeted publishData with
 *    room-wide state so the joiner adopts an existing hold / whisper /
 *    cards mode without a race. `joinedAt` is the responder's own join
 *    time; ties broken by lexicographic identity at the joiner. */
const HelloSchema = z.discriminatedUnion("phase", [
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("hello"),
    phase: z.literal("request"),
  }),
  z.object({
    v: z.literal(ENVELOPE_VERSION),
    ts: z.number().int().nonnegative(),
    type: z.literal("hello"),
    phase: z.literal("snapshot"),
    from: z.string().min(1).max(128),
    joinedAt: z.number().int().nonnegative(),
    held: z
      .object({
        by: z.string().min(1).max(128),
        byName: z.string().min(1).max(64).optional(),
        at: z.number().int().nonnegative(),
      })
      .nullable(),
    whisperOn: z.boolean(),
    cardsEnabled: z.boolean(),
    currentCard: z
      .object({
        id: z.string().min(1).max(64),
        at: z.number().int().nonnegative(),
      })
      .nullable(),
  }),
]);

/** Union of every valid inbound event on the data channel. */
export const RoomEventSchema = z.union([
  ReactionSchema,
  HoldSchema,
  WhisperSchema,
  CardSchema,
  HelloSchema,
  ShareRequestSchema,
  LookAtMeSchema,
  ChatSchema,
]);

export type RoomEvent = z.infer<typeof RoomEventSchema>;
export type ReactionEvent = z.infer<typeof ReactionSchema>;
export type HoldEvent = z.infer<typeof HoldSchema>;
export type WhisperEvent = z.infer<typeof WhisperSchema>;
export type CardEvent = z.infer<typeof CardSchema>;
export type HelloEvent = z.infer<typeof HelloSchema>;
export type ShareRequestEvent = z.infer<typeof ShareRequestSchema>;
export type LookAtMeEvent = z.infer<typeof LookAtMeSchema>;
export type ChatEvent = z.infer<typeof ChatSchema>;

// ---- Encode / decode ------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });

/**
 * Encode an event to the UTF-8 byte payload LiveKit's `publishData` takes.
 *
 * TS 5.7 tightened `TextEncoder.encode` to `Uint8Array<ArrayBufferLike>`,
 * but livekit-client's `publishData` still declares `Uint8Array<ArrayBuffer>`.
 * We copy into a fresh ArrayBuffer so the return type is assignable. One
 * small alloc per publish; envelopes are < 1 KB.
 */
export function encodeEvent(event: RoomEvent): Uint8Array<ArrayBuffer> {
  const source = encoder.encode(JSON.stringify(event));
  const out = new Uint8Array(source.byteLength);
  out.set(source);
  return out;
}

/**
 * Decode + validate an inbound payload. Returns `null` for anything we can't
 * or shouldn't act on (malformed JSON, wrong version, unknown type, bad
 * shape). Never throws — callers can `if (event === null) return`.
 *
 * `onDrop` is optional; when supplied, gets a structured reason for logs.
 * Kept as a callback so this module has zero side effects and stays trivially
 * testable.
 */
export function decodeEvent(
  payload: Uint8Array,
  onDrop?: (reason: DropReason) => void,
): RoomEvent | null {
  let text: string;
  try {
    text = decoder.decode(payload);
  } catch {
    onDrop?.({ kind: "decode_error" });
    return null;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    onDrop?.({ kind: "invalid_json" });
    return null;
  }

  // Version check runs before schema so we don't spend time on a payload we'd
  // drop anyway, and so peers on a future `v` don't spam our error path.
  if (
    typeof raw !== "object" ||
    raw === null ||
    (raw as { v?: unknown }).v !== ENVELOPE_VERSION
  ) {
    onDrop?.({ kind: "wrong_version" });
    return null;
  }

  const parsed = RoomEventSchema.safeParse(raw);
  if (!parsed.success) {
    onDrop?.({ kind: "schema_error" });
    return null;
  }
  return parsed.data;
}

export type DropReason =
  | { kind: "decode_error" }
  | { kind: "invalid_json" }
  | { kind: "wrong_version" }
  | { kind: "schema_error" };
