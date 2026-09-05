import { describe, it, expect, vi } from "vitest";
import {
  ENVELOPE_VERSION,
  decodeEvent,
  encodeEvent,
  type RoomEvent,
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
