/**
 * Pure URL validator for Watch Mode v1.1. No I/O — safe to import from both
 * server and client code. Called client-side before a watch/load publish AND
 * importable from a future server-side preflight route (ADR 0006 §"No new
 * backend surface").
 *
 * TODO(security-review-H1): CSP nonce strategy for script-src is deferred.
 * See docs/product/features/watch-mode-security-review.md §H1 and §M4.
 * Watch Mode's sandbox="allow-scripts allow-same-origin allow-presentation"
 * iframe attribute is the current defence-in-depth; CSP frame-src lands in a
 * follow-up PR once the nonce strategy is decided.
 */

/** Maximum URL input length accepted. URLs beyond this are rejected early. */
const MAX_URL_LENGTH = 2048;

/**
 * Unix-ms upper bound for updatedAt fields — year 2100.
 * Exported so envelope.ts and isWatchEventFresh can share the constant.
 */
export const UPDATED_AT_MAX_MS = 4_102_444_800_000;

/** Skew cap: reject updatedAt values more than 5 minutes in the future. */
const CLOCK_SKEW_MS = 5 * 60 * 1_000;

// ---- Host blocklist (regex-based, no DNS resolution) ----------------------

/**
 * IPv4 CIDR blocks that must never be embeddable. Checked by string prefix
 * or octet-parsed range — no DNS resolution. M2: the per-provider allowlist
 * (YouTube hostname set) is what actually makes this defence correct for v1.1;
 * this blocklist is belt-and-braces against raw IP paste and future providers.
 */
const RFC1918_LOOPBACK_V4 = [
  /^127\.\d+\.\d+\.\d+$/,       // 127.0.0.0/8 — loopback
  /^10\.\d+\.\d+\.\d+$/,        // 10.0.0.0/8
  /^192\.168\.\d+\.\d+$/,       // 192.168.0.0/16
  /^169\.254\.\d+\.\d+$/,       // 169.254.0.0/16 — link-local
];

/** 172.16.0.0/12: second octet 16–31. */
function is172Private(hostname: string): boolean {
  const m = hostname.match(/^172\.(\d+)\.\d+\.\d+$/);
  if (!m) return false;
  const octet = Number(m[1]);
  return octet >= 16 && octet <= 31;
}

const BLOCKED_HOSTNAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback"]);
const BLOCKED_HOSTNAME_SUFFIXES = [".local"];

/** IPv6 prefixes for loopback / ULA / link-local. */
const BLOCKED_V6_PREFIXES = [
  "::1",
  "fc00:",
  "fd",    // ULA fd00::/8 ⊂ fc00::/7
  "fe80:",
];

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();

  // Exact matches.
  if (BLOCKED_HOSTNAMES.has(h)) return true;

  // Suffix matches.
  for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
    if (h.endsWith(suffix)) return true;
  }

  // IPv4 ranges.
  for (const re of RFC1918_LOOPBACK_V4) {
    if (re.test(h)) return true;
  }
  if (is172Private(h)) return true;

  // IPv6.
  // Strip surrounding brackets that URL may leave in url.hostname for IPv6.
  const v6 = h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
  for (const prefix of BLOCKED_V6_PREFIXES) {
    if (v6.startsWith(prefix)) return true;
  }

  return false;
}

// ---- Non-ASCII hostname rejection (M2 remediation) -----------------------

/**
 * Reject hostnames that contain non-ASCII characters in the raw input before
 * URL() normalises to punycode. We read url.hostname (already punycoded) and
 * check for the xn-- ACE prefix which indicates a punycode-encoded label —
 * that means the original input had non-ASCII. Reject it: IDN homograph
 * URLs are out of scope for v1.1 and punycode-encoded provider hostnames
 * should never appear for the YouTube allowlist.
 */
function hasNonAsciiHostname(hostname: string): boolean {
  // url.hostname for IPv6 contains brackets; strip them before splitting.
  const bare = hostname.startsWith("[") ? hostname : hostname;
  return bare.split(".").some((label) => label.toLowerCase().startsWith("xn--"));
}

// ---- YouTube provider -------------------------------------------------------

const YOUTUBE_HOSTS = new Set([
  "www.youtube.com",
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
]);

/** YouTube video ID: exactly 11 chars from [A-Za-z0-9_-]. */
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * Extract a YouTube video ID from a parsed URL.
 *
 * The extractor returns the raw ID string only — no other query params are
 * forwarded. Callers construct the embed URL as
 * `https://www.youtube-nocookie.com/embed/<mediaId>`, so params like
 * ?autoplay=1 or ?t=42 in the source URL are intentionally discarded.
 * This is the M5 remediation: strip all source-URL query params on extraction.
 *
 * Returns null for unrecognised URL shapes on a YouTube host (e.g. playlists,
 * channel pages) — these are out of scope for v1.1.
 */
function extractYouTubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  if (host === "youtu.be") {
    // https://youtu.be/<ID>
    const id = path.slice(1); // strip leading /
    return id || null;
  }

  // Standard watch: ?v=<ID>
  const vParam = url.searchParams.get("v");
  if (vParam) return vParam;

  // Shorts: /shorts/<ID>
  const shortsMatch = path.match(/^\/shorts\/([^/?#]+)/);
  if (shortsMatch) return shortsMatch[1] ?? null;

  // Embed: /embed/<ID>
  const embedMatch = path.match(/^\/embed\/([^/?#]+)/);
  if (embedMatch) return embedMatch[1] ?? null;

  return null;
}

// ---- Public contract -------------------------------------------------------

export type ValidateWatchUrlResult =
  | { ok: true; providerId: "youtube"; mediaId: string }
  | {
      ok: false;
      reason:
        | "not_https"
        | "unknown_provider"
        | "invalid_media_id"
        | "blocked_host"
        | "too_long"
        | "malformed";
    };

/**
 * Validate a user-supplied URL for Watch Mode. Pure function — no I/O.
 *
 * Validation order (reject at first failure):
 *  1. Length cap (too_long)
 *  2. URL parse (malformed)
 *  3. Protocol allowlist — https: only; http: is rejected in all envs
 *     (not_https). javascript:, data:, file:, blob: also reject here.
 *  4. Non-ASCII hostname (blocked_host — M2 remediation)
 *  5. Host blocklist — RFC1918, loopback, link-local (blocked_host)
 *  6. Provider match — YouTube host allowlist (unknown_provider)
 *  7. Media ID extraction + regex validation (invalid_media_id)
 */
export function validateWatchUrl(input: string): ValidateWatchUrlResult {
  if (input.length > MAX_URL_LENGTH) {
    return { ok: false, reason: "too_long" };
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  // Protocol check. Explicit blocklist for belt-and-braces clarity even though
  // the https-only allow covers everything else.
  const proto = url.protocol; // always lowercase with trailing colon
  if (proto !== "https:") {
    return { ok: false, reason: "not_https" };
  }

  const hostname = url.hostname.toLowerCase();

  // Non-ASCII hostname rejection (M2 — IDN homograph defence).
  if (hasNonAsciiHostname(hostname)) {
    return { ok: false, reason: "blocked_host" };
  }

  // RFC1918 / loopback / link-local blocklist.
  if (isBlockedHost(hostname)) {
    return { ok: false, reason: "blocked_host" };
  }

  // Provider match: is this a YouTube host?
  if (!YOUTUBE_HOSTS.has(hostname)) {
    return { ok: false, reason: "unknown_provider" };
  }

  // Media ID extraction.
  const rawId = extractYouTubeId(url);
  if (!rawId || !YOUTUBE_ID_RE.test(rawId)) {
    return { ok: false, reason: "invalid_media_id" };
  }

  return { ok: true, providerId: "youtube", mediaId: rawId };
}

// ---- Runtime skew cap (H2 remediation, layer 2) ---------------------------

/**
 * Returns true if the event's updatedAt timestamp is plausible — i.e. not
 * more than CLOCK_SKEW_MS (5 minutes) in the future relative to nowMs.
 *
 * The schema-level max() on updatedAt catches gross values (year > 2100).
 * This runtime check catches a peer who stamps a high-but-schema-valid
 * future timestamp to become the permanent LWW winner.
 *
 * Usage in useWatchSync: call after Zod parse; drop the event if false.
 *
 * @param payload - Any watch event payload carrying updatedAt.
 * @param nowMs   - Current time in unix-ms. Defaults to Date.now().
 */
export function isWatchEventFresh(
  payload: { updatedAt: number },
  nowMs: number = Date.now(),
): boolean {
  return payload.updatedAt <= nowMs + CLOCK_SKEW_MS;
}
