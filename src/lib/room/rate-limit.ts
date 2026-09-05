/**
 * Client-side sender-side rate limiters. ADR 0005 §6, §7.
 *
 * Distinct from `src/lib/rate-limit.ts` (server-side sliding window for the
 * `/api/rooms` route). These live in the browser, per tab, per feature.
 *
 * The bar is deliberately low: enforce AC5.5 (4 reactions per participant per
 * 3s) and AC6.4 (5-minute card cooldown) so a bug or a hyperactive user
 * doesn't spam the room, and give the caller a clean "allowed / denied"
 * answer. There is no retry queue — dropped events are dropped (matches the
 * PM's "silently dropped, not queued" language).
 */

// ---- Reactions (AC5.5) ---------------------------------------------------

/**
 * Ring buffer of the last N send timestamps. A send is allowed iff the
 * oldest timestamp in the buffer is older than `windowMs` ago (or the buffer
 * isn't full yet).
 *
 * Ring buffer, not an array + shift, because we only care about the last N
 * — no need to keep an unbounded history around.
 */
export class ReactionLimiter {
  private readonly capacity: number;
  private readonly windowMs: number;
  private readonly stamps: number[];
  private head = 0;
  private filled = 0;

  /**
   * @param capacity how many sends allowed inside `windowMs` (AC5.5 → 4)
   * @param windowMs the rolling window (AC5.5 → 3000)
   */
  constructor(capacity = 4, windowMs = 3000) {
    if (capacity <= 0) throw new Error("capacity must be positive");
    if (windowMs <= 0) throw new Error("windowMs must be positive");
    this.capacity = capacity;
    this.windowMs = windowMs;
    this.stamps = new Array<number>(capacity).fill(0);
  }

  /**
   * Try to record a send. Returns `true` if allowed (and recorded), `false`
   * if rate-limited (nothing recorded — a denied client can't inflate the
   * window by hammering; same posture as the server-side limiter).
   */
  tryAcquire(now: number = Date.now()): boolean {
    if (this.filled < this.capacity) {
      this.stamps[this.head] = now;
      this.head = (this.head + 1) % this.capacity;
      this.filled++;
      return true;
    }
    // Full — the head slot is the oldest.
    const oldest = this.stamps[this.head]!;
    if (now - oldest < this.windowMs) return false;
    this.stamps[this.head] = now;
    this.head = (this.head + 1) % this.capacity;
    return true;
  }

  /** Test-only helper — wipe internal state. */
  reset(): void {
    this.head = 0;
    this.filled = 0;
    this.stamps.fill(0);
  }
}

// ---- Card cooldown (AC6.4) -----------------------------------------------

/**
 * Simple "next allowed at" gate. Used for the 5-minute cooldown after a card
 * is dismissed; `mark(now)` sets the next-allowed-at, `isReady(now)` reports
 * whether the cooldown has elapsed.
 *
 * Cooldown is per-client (ADR §7): the room-wide gate is the LWW `currentCard`
 * state, so we don't need to replicate the cooldown across peers. If two
 * peers race to propose after the gate frees, LWW picks one.
 */
export class Cooldown {
  private readonly durationMs: number;
  private nextAllowedAt = 0;

  /** @param durationMs cooldown length (AC6.4 → 5 * 60 * 1000) */
  constructor(durationMs: number) {
    if (durationMs < 0) throw new Error("durationMs must be non-negative");
    this.durationMs = durationMs;
  }

  isReady(now: number = Date.now()): boolean {
    return now >= this.nextAllowedAt;
  }

  /** Record a fire; blocks until `now + durationMs`. */
  mark(now: number = Date.now()): void {
    this.nextAllowedAt = now + this.durationMs;
  }

  /** Test-only helper — reset to "immediately available". */
  reset(): void {
    this.nextAllowedAt = 0;
  }
}
