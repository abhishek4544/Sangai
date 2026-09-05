import { beforeEach, describe, expect, it } from "vitest";
import { __resetRateLimitStore, checkRateLimit } from "./rate-limit";

describe("checkRateLimit — sliding window", () => {
  beforeEach(() => {
    __resetRateLimitStore();
  });

  it("allows up to `limit` requests inside the window", () => {
    const opts = { limit: 3, windowMs: 1000 };
    const t0 = 1_000_000;

    expect(checkRateLimit("ip:1", opts, t0 + 0).allowed).toBe(true);
    expect(checkRateLimit("ip:1", opts, t0 + 100).allowed).toBe(true);
    expect(checkRateLimit("ip:1", opts, t0 + 200).allowed).toBe(true);
  });

  it("blocks the `limit + 1`-th request inside the window", () => {
    const opts = { limit: 3, windowMs: 1000 };
    const t0 = 1_000_000;

    checkRateLimit("ip:2", opts, t0);
    checkRateLimit("ip:2", opts, t0 + 100);
    checkRateLimit("ip:2", opts, t0 + 200);

    const blocked = checkRateLimit("ip:2", opts, t0 + 300);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("unblocks once the oldest hit falls out of the window", () => {
    const opts = { limit: 2, windowMs: 1000 };
    const t0 = 1_000_000;

    checkRateLimit("ip:3", opts, t0); // hit 1
    checkRateLimit("ip:3", opts, t0 + 500); // hit 2
    expect(checkRateLimit("ip:3", opts, t0 + 600).allowed).toBe(false);

    // hit 1 falls out at t0 + 1000, so at t0 + 1001 the window holds only
    // one prior hit (t0 + 500) — the new request should be allowed.
    expect(checkRateLimit("ip:3", opts, t0 + 1001).allowed).toBe(true);
  });

  it("does not record blocked requests (so hammering does not slide the window forward)", () => {
    const opts = { limit: 1, windowMs: 1000 };
    const t0 = 1_000_000;

    checkRateLimit("ip:4", opts, t0);

    // 100 blocked attempts should NOT extend the block past t0 + 1000.
    for (let i = 1; i <= 100; i++) {
      const r = checkRateLimit("ip:4", opts, t0 + i);
      expect(r.allowed).toBe(false);
    }

    // At t0 + 1001 the original hit falls out of the window.
    expect(checkRateLimit("ip:4", opts, t0 + 1001).allowed).toBe(true);
  });

  it("keys are isolated from each other", () => {
    const opts = { limit: 1, windowMs: 1000 };
    const t0 = 1_000_000;

    expect(checkRateLimit("a", opts, t0).allowed).toBe(true);
    expect(checkRateLimit("a", opts, t0 + 1).allowed).toBe(false);

    // A different key gets its own bucket.
    expect(checkRateLimit("b", opts, t0 + 1).allowed).toBe(true);
  });

  it("reports retry-after as at least 1 second", () => {
    const opts = { limit: 1, windowMs: 500 };
    const t0 = 1_000_000;

    checkRateLimit("ip:5", opts, t0);
    // Even at the very last ms before the window frees, retry-after is at
    // least 1s — clients honoring `Retry-After: 0` would busy-loop.
    const r = checkRateLimit("ip:5", opts, t0 + 499);
    expect(r.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});
