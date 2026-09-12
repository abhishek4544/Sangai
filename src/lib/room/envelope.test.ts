import { describe, it, expect, vi } from "vitest";
import {
  ENVELOPE_VERSION,
  decodeEvent,
  encodeEvent,
  type RoomEvent,
  type WatchLoadEvent,
  type WatchPlayEvent,
  type WatchPauseEvent,
  type WatchSeekEvent,
  type WatchHeartbeatEvent,
  type WatchStopEvent,
} from "./envelope";

function bytes(json: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(json));
}

describe("envelope round-trip", () => {
  it("reaction survives encode → decode intact", () => {
    const event: RoomEvent = {
      v: ENVELOPE_VERSION,
      ts: 1_700_000_000_000,
      type: "reaction",
      emoji: "😂",
      id: "r-1",
      name: "Sarushna",
    };
    expect(decodeEvent(encodeEvent(event))).toEqual(event);
  });

  it("hold(true) with initiator round-trips", () => {
    const event: RoomEvent = {
      v: ENVELOPE_VERSION,
      ts: 42,
      type: "hold",
      held: true,
      by: "uuid-abc",
      byName: "Alex",
    };
    expect(decodeEvent(encodeEvent(event))).toEqual(event);
  });

  it("hold(false) with no initiator round-trips", () => {
    const event: RoomEvent = {
      v: ENVELOPE_VERSION,
      ts: 42,
      type: "hold",
      held: false,
    };
    expect(decodeEvent(encodeEvent(event))).toEqual(event);
  });

  it("whisper voice-on / voice-off / toggle all round-trip", () => {
    for (const event of [
      { v: ENVELOPE_VERSION, ts: 1, type: "whisper", phase: "toggle", on: true },
      { v: ENVELOPE_VERSION, ts: 2, type: "whisper", phase: "voice-on" },
      { v: ENVELOPE_VERSION, ts: 3, type: "whisper", phase: "voice-off" },
    ] as const) {
      expect(decodeEvent(encodeEvent(event))).toEqual(event);
    }
  });

  it("card propose / dismiss / toggle round-trip", () => {
    for (const event of [
      { v: ENVELOPE_VERSION, ts: 1, type: "card", phase: "propose", id: "c.7" },
      { v: ENVELOPE_VERSION, ts: 2, type: "card", phase: "dismiss", id: "c.7" },
      { v: ENVELOPE_VERSION, ts: 3, type: "card", phase: "toggle", on: false },
    ] as const) {
      expect(decodeEvent(encodeEvent(event))).toEqual(event);
    }
  });

  it("chat round-trips", () => {
    const event: RoomEvent = {
      v: ENVELOPE_VERSION,
      ts: 4321,
      type: "chat",
      text: "hey there!",
      name: "Sarushna",
    };
    expect(decodeEvent(encodeEvent(event))).toEqual(event);
  });

  it("chat rejects an empty string and >500 chars", () => {
    const base = { v: ENVELOPE_VERSION, ts: 1, type: "chat", name: "S" };
    expect(decodeEvent(bytes({ ...base, text: "" }))).toBeNull();
    expect(decodeEvent(bytes({ ...base, text: "x".repeat(501) }))).toBeNull();
    // 500 exact is fine.
    expect(decodeEvent(bytes({ ...base, text: "x".repeat(500) }))).not.toBeNull();
  });

  it("lookAtMe round-trips", () => {
    const event: RoomEvent = {
      v: ENVELOPE_VERSION,
      ts: 999,
      type: "lookAtMe",
      name: "Alex",
    };
    expect(decodeEvent(encodeEvent(event))).toEqual(event);
  });

  it("shareRequest round-trips", () => {
    const event: RoomEvent = {
      v: ENVELOPE_VERSION,
      ts: 12345,
      type: "shareRequest",
      name: "Bob",
    };
    expect(decodeEvent(encodeEvent(event))).toEqual(event);
  });

  it("hello request and snapshot round-trip", () => {
    const req: RoomEvent = {
      v: ENVELOPE_VERSION,
      ts: 1,
      type: "hello",
      phase: "request",
    };
    expect(decodeEvent(encodeEvent(req))).toEqual(req);

    const snap: RoomEvent = {
      v: ENVELOPE_VERSION,
      ts: 100,
      type: "hello",
      phase: "snapshot",
      from: "uuid-peer",
      joinedAt: 10,
      held: { by: "uuid-init", byName: "Sam", at: 50 },
      whisperOn: true,
      cardsEnabled: false,
      currentCard: { id: "c.3", at: 60 },
    };
    expect(decodeEvent(encodeEvent(snap))).toEqual(snap);
  });
});

describe("envelope drops (silent-drop posture)", () => {
  it("drops malformed JSON with reason invalid_json", () => {
    const onDrop = vi.fn();
    const result = decodeEvent(new TextEncoder().encode("{not-json"), onDrop);
    expect(result).toBeNull();
    expect(onDrop).toHaveBeenCalledWith({ kind: "invalid_json" });
  });

  it("drops mismatched envelope version with reason wrong_version", () => {
    const onDrop = vi.fn();
    const result = decodeEvent(
      bytes({ v: 2, ts: 1, type: "reaction", emoji: "😂", id: "x", name: "S" }),
      onDrop,
    );
    expect(result).toBeNull();
    expect(onDrop).toHaveBeenCalledWith({ kind: "wrong_version" });
  });

  it("drops unknown type with reason schema_error", () => {
    const onDrop = vi.fn();
    const result = decodeEvent(
      bytes({ v: ENVELOPE_VERSION, ts: 1, type: "chat", text: "hi" }),
      onDrop,
    );
    expect(result).toBeNull();
    expect(onDrop).toHaveBeenCalledWith({ kind: "schema_error" });
  });

  it("drops a reaction missing required fields", () => {
    const onDrop = vi.fn();
    const result = decodeEvent(
      bytes({ v: ENVELOPE_VERSION, ts: 1, type: "reaction", emoji: "😂" }),
      onDrop,
    );
    expect(result).toBeNull();
    expect(onDrop).toHaveBeenCalledWith({ kind: "schema_error" });
  });

  it("drops a whisper with an unknown phase", () => {
    const onDrop = vi.fn();
    const result = decodeEvent(
      bytes({ v: ENVELOPE_VERSION, ts: 1, type: "whisper", phase: "shout" }),
      onDrop,
    );
    expect(result).toBeNull();
    expect(onDrop).toHaveBeenCalledWith({ kind: "schema_error" });
  });

  it("drops a top-level non-object payload", () => {
    const onDrop = vi.fn();
    expect(decodeEvent(bytes(null), onDrop)).toBeNull();
    expect(decodeEvent(bytes(42), onDrop)).toBeNull();
    expect(decodeEvent(bytes("hi"), onDrop)).toBeNull();
    // All three take the wrong_version path (v !== 1).
    expect(onDrop).toHaveBeenCalledTimes(3);
  });

  it("does not throw when onDrop is omitted", () => {
    expect(() => decodeEvent(bytes({ nope: true }))).not.toThrow();
    expect(decodeEvent(bytes({ nope: true }))).toBeNull();
  });
});

// ---- Watch Mode envelope round-trips (W-1.1) --------------------------------

const TS = 1_700_000_000_000;
const VALID_MEDIA_ID = "dQw4w9WgXcQ";
const VALID_UPDATED_AT = 1_700_000_001_000;

describe("watch/* envelope round-trips", () => {
  it("watch/load round-trips", () => {
    const event: WatchLoadEvent = {
      v: ENVELOPE_VERSION,
      ts: TS,
      type: "watch/load",
      providerId: "youtube",
      mediaId: VALID_MEDIA_ID,
      positionSec: 0,
      updatedAt: VALID_UPDATED_AT,
    };
    expect(decodeEvent(encodeEvent(event as RoomEvent))).toEqual(event);
  });

  it("watch/play round-trips", () => {
    const event: WatchPlayEvent = {
      v: ENVELOPE_VERSION,
      ts: TS,
      type: "watch/play",
      positionSec: 42.5,
      updatedAt: VALID_UPDATED_AT,
    };
    expect(decodeEvent(encodeEvent(event as RoomEvent))).toEqual(event);
  });

  it("watch/pause round-trips", () => {
    const event: WatchPauseEvent = {
      v: ENVELOPE_VERSION,
      ts: TS,
      type: "watch/pause",
      positionSec: 100,
      updatedAt: VALID_UPDATED_AT,
    };
    expect(decodeEvent(encodeEvent(event as RoomEvent))).toEqual(event);
  });

  it("watch/seek round-trips", () => {
    const event: WatchSeekEvent = {
      v: ENVELOPE_VERSION,
      ts: TS,
      type: "watch/seek",
      positionSec: 3600,
      updatedAt: VALID_UPDATED_AT,
    };
    expect(decodeEvent(encodeEvent(event as RoomEvent))).toEqual(event);
  });

  it("watch/heartbeat round-trips", () => {
    const event: WatchHeartbeatEvent = {
      v: ENVELOPE_VERSION,
      ts: TS,
      type: "watch/heartbeat",
      positionSec: 0,
      updatedAt: VALID_UPDATED_AT,
    };
    expect(decodeEvent(encodeEvent(event as RoomEvent))).toEqual(event);
  });

  it("watch/stop round-trips", () => {
    const event: WatchStopEvent = {
      v: ENVELOPE_VERSION,
      ts: TS,
      type: "watch/stop",
      updatedAt: VALID_UPDATED_AT,
    };
    expect(decodeEvent(encodeEvent(event as RoomEvent))).toEqual(event);
  });
});

describe("watch/* envelope rejection (malformed payloads)", () => {
  it("rejects watch/load with invalid mediaId (bad chars)", () => {
    expect(
      decodeEvent(
        bytes({
          v: ENVELOPE_VERSION,
          ts: TS,
          type: "watch/load",
          providerId: "youtube",
          mediaId: "bad id!!!!!",
          positionSec: 0,
          updatedAt: VALID_UPDATED_AT,
        }),
      ),
    ).toBeNull();
  });

  it("rejects watch/load with mediaId shorter than 11 chars", () => {
    expect(
      decodeEvent(
        bytes({
          v: ENVELOPE_VERSION,
          ts: TS,
          type: "watch/load",
          providerId: "youtube",
          mediaId: "dQw4w9WgXc", // 10 chars
          positionSec: 0,
          updatedAt: VALID_UPDATED_AT,
        }),
      ),
    ).toBeNull();
  });

  it("rejects watch/load with mediaId longer than 11 chars", () => {
    expect(
      decodeEvent(
        bytes({
          v: ENVELOPE_VERSION,
          ts: TS,
          type: "watch/load",
          providerId: "youtube",
          mediaId: "dQw4w9WgXcQQ", // 12 chars
          positionSec: 0,
          updatedAt: VALID_UPDATED_AT,
        }),
      ),
    ).toBeNull();
  });

  it("rejects watch/load with unknown providerId — security-review open question #4", () => {
    expect(
      decodeEvent(
        bytes({
          v: ENVELOPE_VERSION,
          ts: TS,
          type: "watch/load",
          providerId: "malicious-provider",
          mediaId: VALID_MEDIA_ID,
          positionSec: 0,
          updatedAt: VALID_UPDATED_AT,
        }),
      ),
    ).toBeNull();
  });

  it("rejects watch/load with updatedAt above year-2100 cap (H2 boundary)", () => {
    expect(
      decodeEvent(
        bytes({
          v: ENVELOPE_VERSION,
          ts: TS,
          type: "watch/load",
          providerId: "youtube",
          mediaId: VALID_MEDIA_ID,
          positionSec: 0,
          updatedAt: 4_102_444_800_001, // exactly one ms over the cap
        }),
      ),
    ).toBeNull();
  });

  it("accepts watch/load with updatedAt exactly at the year-2100 cap", () => {
    expect(
      decodeEvent(
        bytes({
          v: ENVELOPE_VERSION,
          ts: TS,
          type: "watch/load",
          providerId: "youtube",
          mediaId: VALID_MEDIA_ID,
          positionSec: 0,
          updatedAt: 4_102_444_800_000,
        }),
      ),
    ).not.toBeNull();
  });

  it("rejects watch/play with negative positionSec (L2 boundary)", () => {
    expect(
      decodeEvent(
        bytes({
          v: ENVELOPE_VERSION,
          ts: TS,
          type: "watch/play",
          positionSec: -1,
          updatedAt: VALID_UPDATED_AT,
        }),
      ),
    ).toBeNull();
  });

  it("rejects watch/pause with positionSec > 86400 (L2 boundary)", () => {
    expect(
      decodeEvent(
        bytes({
          v: ENVELOPE_VERSION,
          ts: TS,
          type: "watch/pause",
          positionSec: 86_401,
          updatedAt: VALID_UPDATED_AT,
        }),
      ),
    ).toBeNull();
  });

  it("accepts watch/seek with positionSec exactly 86400", () => {
    expect(
      decodeEvent(
        bytes({
          v: ENVELOPE_VERSION,
          ts: TS,
          type: "watch/seek",
          positionSec: 86_400,
          updatedAt: VALID_UPDATED_AT,
        }),
      ),
    ).not.toBeNull();
  });

  it("rejects watch/heartbeat with updatedAt: Number.MAX_SAFE_INTEGER (H2 griefing vector)", () => {
    expect(
      decodeEvent(
        bytes({
          v: ENVELOPE_VERSION,
          ts: TS,
          type: "watch/heartbeat",
          positionSec: 0,
          updatedAt: Number.MAX_SAFE_INTEGER,
        }),
      ),
    ).toBeNull();
  });

  it("does not break existing event decoding (additive union check)", () => {
    const reaction: RoomEvent = {
      v: ENVELOPE_VERSION,
      ts: TS,
      type: "reaction",
      emoji: "🎬",
      id: "r-1",
      name: "Sarushna",
    };
    expect(decodeEvent(encodeEvent(reaction))).toEqual(reaction);
  });
});

describe("hello/snapshot with watchState (ADR 0006 late-joiner handshake)", () => {
  it("snapshot without watchState field decodes cleanly (backward compat)", () => {
    const snap: RoomEvent = {
      v: ENVELOPE_VERSION,
      ts: TS,
      type: "hello",
      phase: "snapshot",
      from: "uuid-peer",
      joinedAt: 10,
      held: null,
      whisperOn: false,
      cardsEnabled: false,
      currentCard: null,
    };
    expect(decodeEvent(encodeEvent(snap))).toEqual(snap);
  });

  it("snapshot with watchState: absent (field omitted) decodes cleanly", () => {
    const snap = bytes({
      v: ENVELOPE_VERSION,
      ts: TS,
      type: "hello",
      phase: "snapshot",
      from: "uuid-peer",
      joinedAt: 10,
      held: null,
      whisperOn: false,
      cardsEnabled: false,
      currentCard: null,
      // watchState intentionally absent
    });
    const decoded = decodeEvent(snap);
    expect(decoded).not.toBeNull();
    if (decoded?.type === "hello" && decoded.phase === "snapshot") {
      expect(decoded.watchState).toBeUndefined();
    }
  });

  it("snapshot with fully-populated watchState decodes and round-trips", () => {
    const snap = bytes({
      v: ENVELOPE_VERSION,
      ts: TS,
      type: "hello",
      phase: "snapshot",
      from: "uuid-peer",
      joinedAt: 10,
      held: null,
      whisperOn: false,
      cardsEnabled: false,
      currentCard: null,
      watchState: {
        providerId: "youtube",
        mediaId: VALID_MEDIA_ID,
        playbackState: "playing",
        positionSec: 42,
        updatedAt: VALID_UPDATED_AT,
      },
    });
    const decoded = decodeEvent(snap);
    expect(decoded).not.toBeNull();
    if (decoded?.type === "hello" && decoded.phase === "snapshot") {
      expect(decoded.watchState).toEqual({
        providerId: "youtube",
        mediaId: VALID_MEDIA_ID,
        playbackState: "playing",
        positionSec: 42,
        updatedAt: VALID_UPDATED_AT,
      });
    }
  });

  it("snapshot with watchState.playbackState: paused decodes correctly", () => {
    const snap = bytes({
      v: ENVELOPE_VERSION,
      ts: TS,
      type: "hello",
      phase: "snapshot",
      from: "uuid-peer",
      joinedAt: 10,
      held: null,
      whisperOn: false,
      cardsEnabled: false,
      currentCard: null,
      watchState: {
        providerId: "youtube",
        mediaId: VALID_MEDIA_ID,
        playbackState: "paused",
        positionSec: 0,
        updatedAt: VALID_UPDATED_AT,
      },
    });
    expect(decodeEvent(snap)).not.toBeNull();
  });

  it("snapshot with watchState.updatedAt above year-2100 cap is rejected (H2)", () => {
    const snap = bytes({
      v: ENVELOPE_VERSION,
      ts: TS,
      type: "hello",
      phase: "snapshot",
      from: "uuid-peer",
      joinedAt: 10,
      held: null,
      whisperOn: false,
      cardsEnabled: false,
      currentCard: null,
      watchState: {
        providerId: "youtube",
        mediaId: VALID_MEDIA_ID,
        playbackState: "playing",
        positionSec: 0,
        updatedAt: 4_102_444_800_001,
      },
    });
    expect(decodeEvent(snap)).toBeNull();
  });

  it("snapshot with watchState.providerId = 'malicious-provider' is rejected (Q4)", () => {
    const snap = bytes({
      v: ENVELOPE_VERSION,
      ts: TS,
      type: "hello",
      phase: "snapshot",
      from: "uuid-peer",
      joinedAt: 10,
      held: null,
      whisperOn: false,
      cardsEnabled: false,
      currentCard: null,
      watchState: {
        providerId: "malicious-provider",
        mediaId: VALID_MEDIA_ID,
        playbackState: "playing",
        positionSec: 0,
        updatedAt: VALID_UPDATED_AT,
      },
    });
    expect(decodeEvent(snap)).toBeNull();
  });
});
