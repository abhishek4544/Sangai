import { describe, it, expect } from "vitest";
import { Cooldown, ReactionLimiter } from "./rate-limit";

describe("ReactionLimiter (AC5.5 — 4 per 3s)", () => {
  it("allows the first 4 sends inside the window", () => {
    const l = new ReactionLimiter(4, 3000);
    expect(l.tryAcquire(1000)).toBe(true);
    expect(l.tryAcquire(1100)).toBe(true);
    expect(l.tryAcquire(1200)).toBe(true);
    expect(l.tryAcquire(1300)).toBe(true);
  });

  it("denies the 5th send inside the window", () => {
    const l = new ReactionLimiter(4, 3000);
    for (const t of [1000, 1100, 1200, 1300]) l.tryAcquire(t);
    expect(l.tryAcquire(1400)).toBe(false);
  });

  it("allows again after the oldest send falls out of the window", () => {
    const l = new ReactionLimiter(4, 3000);
    for (const t of [1000, 1100, 1200, 1300]) l.tryAcquire(t);
    expect(l.tryAcquire(3999)).toBe(false);
    // 1000 + 3000 = 4000; at exactly 4000 the oldest is 3000ms old, so it
    // has just aged out.
    expect(l.tryAcquire(4000)).toBe(true);
  });

  it("denied sends do not consume a slot (no window inflation)", () => {
    const l = new ReactionLimiter(4, 3000);
    for (const t of [1000, 1100, 1200, 1300]) l.tryAcquire(t);
    // Hammer while denied — none of these should be recorded.
    for (let t = 1400; t < 3999; t += 100) expect(l.tryAcquire(t)).toBe(false);
    // Oldest is still 1000 → free at 4000.
    expect(l.tryAcquire(4000)).toBe(true);
  });

  it("rejects invalid constructor args", () => {
    expect(() => new ReactionLimiter(0, 1000)).toThrow();
    expect(() => new ReactionLimiter(4, 0)).toThrow();
  });
});

describe("Cooldown (AC6.4 — 5-minute cooldown after dismiss)", () => {
  it("starts ready", () => {
    const c = new Cooldown(5 * 60_000);
    expect(c.isReady(0)).toBe(true);
    expect(c.isReady(9_999_999)).toBe(true);
  });

  it("blocks for the full duration after mark()", () => {
    const c = new Cooldown(5 * 60_000);
    c.mark(1_000_000);
    expect(c.isReady(1_000_000)).toBe(false);
    expect(c.isReady(1_000_000 + 5 * 60_000 - 1)).toBe(false);
    expect(c.isReady(1_000_000 + 5 * 60_000)).toBe(true);
  });

  it("mark() from an idle state restarts the timer from the new now", () => {
    const c = new Cooldown(1000);
    c.mark(0);
    // Ready at t=1000
    expect(c.isReady(1000)).toBe(true);
    c.mark(2000);
    expect(c.isReady(2500)).toBe(false);
    expect(c.isReady(3000)).toBe(true);
  });

  it("reset() clears the block", () => {
    const c = new Cooldown(1000);
    c.mark(100);
    expect(c.isReady(200)).toBe(false);
    c.reset();
    expect(c.isReady(200)).toBe(true);
  });
});
