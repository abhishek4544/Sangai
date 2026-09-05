import { describe, it, expect } from "vitest";
import { ENVELOPE_VERSION } from "./envelope";
import {
  adoptSnapshot,
  applyEvent,
  initialRoomState,
  releaseHoldOnDisconnect,
} from "./state";

const V = ENVELOPE_VERSION;

describe("initialRoomState", () => {
  it("starts empty with cards on by default (AC6.5)", () => {
    const s = initialRoomState();
    expect(s.held).toBeNull();
    expect(s.whisperOn).toBe(false);
    expect(s.cardsEnabled).toBe(true);
    expect(s.currentCard).toBeNull();
  });
});

describe("applyEvent — hold (AC1.x, LWW)", () => {
  it("applies hold(true) with initiator identity", () => {
    const s = applyEvent(initialRoomState(), {
      v: V,
      ts: 100,
      type: "hold",
      held: true,
      by: "u-1",
      byName: "Alex",
    });
    expect(s.held).toEqual({ by: "u-1", byName: "Alex", at: 100 });
    expect(s.updatedAt.held).toBe(100);
  });

  it("applies hold(false) to clear the banner", () => {
    let s = applyEvent(initialRoomState(), {
      v: V,
      ts: 100,
      type: "hold",
      held: true,
      by: "u-1",
    });
    s = applyEvent(s, { v: V, ts: 200, type: "hold", held: false });
    expect(s.held).toBeNull();
    expect(s.updatedAt.held).toBe(200);
  });

  it("ignores an older-ts hold event (LWW)", () => {
    let s = applyEvent(initialRoomState(), {
      v: V,
      ts: 200,
      type: "hold",
      held: true,
      by: "u-1",
    });
    s = applyEvent(s, {
      v: V,
      ts: 100,
      type: "hold",
      held: true,
      by: "u-2",
    });
    expect(s.held?.by).toBe("u-1");
    expect(s.updatedAt.held).toBe(200);
  });

  it("ignores an equal-ts hold event (incumbent wins on tie)", () => {
    let s = applyEvent(initialRoomState(), {
      v: V,
      ts: 100,
      type: "hold",
      held: true,
      by: "u-1",
    });
    s = applyEvent(s, {
      v: V,
      ts: 100,
      type: "hold",
      held: true,
      by: "u-2",
    });
    expect(s.held?.by).toBe("u-1");
  });
});

describe("applyEvent — whisper toggle (AC4.6, LWW)", () => {
  it("applies whisper(on)", () => {
    const s = applyEvent(initialRoomState(), {
      v: V,
      ts: 10,
      type: "whisper",
      phase: "toggle",
      on: true,
    });
    expect(s.whisperOn).toBe(true);
    expect(s.updatedAt.whisperOn).toBe(10);
  });

  it("older-ts toggle is dropped", () => {
    let s = applyEvent(initialRoomState(), {
      v: V,
      ts: 20,
      type: "whisper",
      phase: "toggle",
      on: true,
    });
    s = applyEvent(s, {
      v: V,
      ts: 5,
      type: "whisper",
      phase: "toggle",
      on: false,
    });
    expect(s.whisperOn).toBe(true);
  });

  it("voice-on / voice-off do not change room state", () => {
    const start = initialRoomState();
    const a = applyEvent(start, {
      v: V,
      ts: 1,
      type: "whisper",
      phase: "voice-on",
    });
    const b = applyEvent(a, {
      v: V,
      ts: 2,
      type: "whisper",
      phase: "voice-off",
    });
    expect(b).toEqual(start);
  });
});

describe("applyEvent — cards (AC6.x)", () => {
  it("propose sets currentCard when cardsEnabled", () => {
    const s = applyEvent(initialRoomState(), {
      v: V,
      ts: 50,
      type: "card",
      phase: "propose",
      id: "c.1",
    });
    expect(s.currentCard).toEqual({ id: "c.1", at: 50 });
  });

  it("propose is dropped when cards toggled off", () => {
    let s = applyEvent(initialRoomState(), {
      v: V,
      ts: 10,
      type: "card",
      phase: "toggle",
      on: false,
    });
    s = applyEvent(s, {
      v: V,
      ts: 50,
      type: "card",
      phase: "propose",
      id: "c.1",
    });
    expect(s.currentCard).toBeNull();
  });

  it("dismiss clears the visible card (AC6.3)", () => {
    let s = applyEvent(initialRoomState(), {
      v: V,
      ts: 50,
      type: "card",
      phase: "propose",
      id: "c.1",
    });
    s = applyEvent(s, {
      v: V,
      ts: 60,
      type: "card",
      phase: "dismiss",
      id: "c.1",
    });
    expect(s.currentCard).toBeNull();
    expect(s.updatedAt.currentCard).toBe(60);
  });

  it("dismiss for a stale card id is ignored", () => {
    let s = applyEvent(initialRoomState(), {
      v: V,
      ts: 50,
      type: "card",
      phase: "propose",
      id: "c.1",
    });
    s = applyEvent(s, {
      v: V,
      ts: 60,
      type: "card",
      phase: "dismiss",
      id: "c.OLD",
    });
    expect(s.currentCard).toEqual({ id: "c.1", at: 50 });
  });

  it("toggle(off) clears an active card (AC6.5)", () => {
    let s = applyEvent(initialRoomState(), {
      v: V,
      ts: 50,
      type: "card",
      phase: "propose",
      id: "c.1",
    });
    s = applyEvent(s, {
      v: V,
      ts: 60,
      type: "card",
      phase: "toggle",
      on: false,
    });
    expect(s.cardsEnabled).toBe(false);
    expect(s.currentCard).toBeNull();
  });

  it("propose with older ts than currentCard is ignored (LWW)", () => {
    let s = applyEvent(initialRoomState(), {
      v: V,
      ts: 100,
      type: "card",
      phase: "propose",
      id: "c.1",
    });
    s = applyEvent(s, {
      v: V,
      ts: 50,
      type: "card",
      phase: "propose",
      id: "c.2",
    });
    expect(s.currentCard?.id).toBe("c.1");
  });
});

describe("applyEvent — reactions and hello are no-ops for state", () => {
  it("reactions do not change room state", () => {
    const start = initialRoomState();
    const s = applyEvent(start, {
      v: V,
      ts: 1,
      type: "reaction",
      emoji: "😂",
      id: "r-1",
      name: "S",
    });
    expect(s).toEqual(start);
  });

  it("hello request does not change room state", () => {
    const start = initialRoomState();
    const s = applyEvent(start, {
      v: V,
      ts: 1,
      type: "hello",
      phase: "request",
    });
    expect(s).toEqual(start);
  });
});

describe("adoptSnapshot", () => {
  it("adopts held / whisper / cardsEnabled / currentCard on empty state", () => {
    const snap = {
      v: V,
      ts: 999,
      type: "hello",
      phase: "snapshot",
      from: "peer",
      joinedAt: 10,
      held: { by: "u-1", byName: "A", at: 50 },
      whisperOn: true,
      cardsEnabled: false,
      currentCard: { id: "c.5", at: 60 },
    } as const;
    const s = adoptSnapshot(initialRoomState(), snap);
    expect(s.held).toEqual(snap.held);
    expect(s.whisperOn).toBe(true);
    expect(s.cardsEnabled).toBe(false);
    expect(s.currentCard).toEqual(snap.currentCard);
  });

  it("does not overwrite a newer local held from an older snapshot", () => {
    let s = applyEvent(initialRoomState(), {
      v: V,
      ts: 100,
      type: "hold",
      held: true,
      by: "u-local",
    });
    s = adoptSnapshot(s, {
      v: V,
      ts: 200,
      type: "hello",
      phase: "snapshot",
      from: "peer",
      joinedAt: 0,
      held: { by: "u-old", at: 50 },
      whisperOn: false,
      cardsEnabled: true,
      currentCard: null,
    });
    expect(s.held?.by).toBe("u-local");
  });

  it("does not downgrade whisper if we already observed a real toggle", () => {
    let s = applyEvent(initialRoomState(), {
      v: V,
      ts: 100,
      type: "whisper",
      phase: "toggle",
      on: true,
    });
    s = adoptSnapshot(s, {
      v: V,
      ts: 500,
      type: "hello",
      phase: "snapshot",
      from: "peer",
      joinedAt: 0,
      held: null,
      whisperOn: false,
      cardsEnabled: true,
      currentCard: null,
    });
    expect(s.whisperOn).toBe(true);
  });
});

describe("releaseHoldOnDisconnect (AC1.3)", () => {
  it("clears the hold when the initiator drops", () => {
    let s = applyEvent(initialRoomState(), {
      v: V,
      ts: 100,
      type: "hold",
      held: true,
      by: "u-init",
    });
    s = releaseHoldOnDisconnect(s, "u-init");
    expect(s.held).toBeNull();
  });

  it("no-op when someone other than the initiator drops", () => {
    const held = applyEvent(initialRoomState(), {
      v: V,
      ts: 100,
      type: "hold",
      held: true,
      by: "u-init",
    });
    const after = releaseHoldOnDisconnect(held, "u-guest");
    expect(after.held?.by).toBe("u-init");
  });

  it("no-op when there's no active hold", () => {
    const start = initialRoomState();
    expect(releaseHoldOnDisconnect(start, "u-init")).toBe(start);
  });

  it("does not bump updatedAt so a late initiator retry is still LWW-guarded", () => {
    let s = applyEvent(initialRoomState(), {
      v: V,
      ts: 100,
      type: "hold",
      held: true,
      by: "u-init",
    });
    s = releaseHoldOnDisconnect(s, "u-init");
    expect(s.updatedAt.held).toBe(100);
    // A stale in-flight retry with the same ts must not resurrect the hold.
    s = applyEvent(s, {
      v: V,
      ts: 100,
      type: "hold",
      held: true,
      by: "u-init",
    });
    expect(s.held).toBeNull();
  });
});
