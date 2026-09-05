/**
 * In-process sliding-window rate limiter.
 *
 * ADR 0004 accepts this as MVP tech debt: Vercel serverless instances are
 * ephemeral, so a `Map` limiter is per-instance-and-per-cold-start. That's
 * intentionally weak — the platform's DDoS protection sits in front, and
 * we track "move to Vercel KV / Upstash Redis" as tech debt with the same
 * trigger as the discover route's rate limiter.
 *
 * Sliding window (not fixed): we keep the raw request timestamps and count
 * how many fall inside the trailing `windowMs`. This avoids the classic
 * fixed-window burst at the boundary (e.g. 2× the limit landing in the last
 * ms of window N and the first ms of window N+1).
 */

type Timestamps = number[];

const store = new Map<string, Timestamps>();

// Periodic GC would be nice but we're serverless — the instance itself is
// short-lived, so we rely on the process dying to reclaim memory. We do
// prune expired entries lazily on every call to the key we're checking.

export interface RateLimitOptions {
  /** Max requests allowed inside `windowMs`. */
  limit: number;
  /** Window size in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the next request slot frees up (rounded up). 0 when allowed. */
  retryAfterSeconds: number;
}

/**
 * Check-and-record. If allowed, records `now` as a hit against `key` and
 * returns `{ allowed: true, retryAfterSeconds: 0 }`. If blocked, does NOT
 * record (so a blocked client can't inflate the window by hammering) and
 * returns the seconds until the oldest in-window hit falls out.
 */
export function checkRateLimit(
  key: string,
  { limit, windowMs }: RateLimitOptions,
  now: number = Date.now(),
): RateLimitResult {
  const cutoff = now - windowMs;
  const raw = store.get(key) ?? [];
  // Drop expired timestamps. Timestamps are appended in monotonic order so
  // we can splice from the front — but in tests the caller may pass an
  // explicit `now` that moves backwards, so filter defensively.
  const kept: Timestamps = [];
  for (const t of raw) {
    if (t > cutoff) kept.push(t);
  }

  if (kept.length >= limit) {
    store.set(key, kept);
    const oldest = kept[0] ?? now;
    const msUntilFree = oldest + windowMs - now;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(msUntilFree / 1000)),
    };
  }

  kept.push(now);
  store.set(key, kept);
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Test-only: wipe the limiter state between test cases. */
export function __resetRateLimitStore(): void {
  store.clear();
}
