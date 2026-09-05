# Security Review — Watch-Together MVP (W-MVP)

**Reviewer:** Security engineer sub-agent
**Date:** 2026-09-04
**Scope:** The code shipped under W-MVP for `POST /api/rooms`,
`POST /api/rooms/[code]/join`, `/`, and `/room/[code]`, plus supporting
libs in `src/lib/` and `src/lib/livekit/`.
**Reference specs:** `docs/product/features/watch-together-mvp.md`, ADR 0004
(`docs/architecture/adr/0004-watch-together-livekit.md`), `CLAUDE.md`.

---

## Executive summary

Overall posture is **good for an MVP**. The token-mint path is
well-scoped (10-min TTL, room-scoped grants, per-session UUID identity,
`server-only`-guarded env), the room-code alphabet + rejection-sampling
generator is correct, and the rate-limit envelope is defensible for the
≤ 100-concurrent-room target that ADR 0004 explicitly sizes for. Nickname
XSS surface is closed by React text-node rendering; there is no
`dangerouslySetInnerHTML` anywhere in the app.

**Most-important finding:** the app ships **no HTTP security headers**
(no CSP, no `X-Frame-Options`, no `Referrer-Policy`, no
`Permissions-Policy`). None is exploitable today, but their absence
removes the second layer of defence for the room page, which is exactly
where the app holds LiveKit tokens in `sessionStorage` and requests
camera/mic. Adding a minimal header set in `next.config.ts` is a
< 30-line, one-file change and would materially reduce blast radius if
any future feature accidentally opens an XSS or clickjacking vector.

**Ship recommendation:** **Ship with fixes.** Land the security-headers
patch (fixed in this review — see below) before public link-sharing.
Everything else is Medium or lower and can ride along.

---

## Findings

| Severity | Title | Location |
|---|---|---|
| High | No HTTP security headers on any route | `next.config.ts` (missing) |
| Medium | `x-forwarded-for` first-hop trust is deployment-portable footgun | `src/app/api/rooms/route.ts:36-45`, `src/app/api/rooms/[code]/join/route.ts:59-65` |
| Medium | Rate-limiter fallback fingerprint is trivially rotated | `src/app/api/rooms/route.ts:42-44`, `src/app/api/rooms/[code]/join/route.ts:63-64` |
| Medium | Nickname sanitization does not strip Unicode format / bidi characters | `src/app/api/rooms/[code]/join/route.ts:39-46` |
| Medium | Nickname length is measured in UTF-16 code units, not grapheme clusters | `src/app/api/rooms/[code]/join/route.ts:44` |
| Low | `createRoom` retry loop treats every error as a collision, amplifying LiveKit outages | `src/app/api/rooms/route.ts:70-100` |
| Low | Host-side `setName` bypasses the server-side nickname sanitizer | `src/app/room/[code]/RoomClient.tsx:172-176` |
| Low | 400 `invalid_code` is returned before rate-limit check | `src/app/api/rooms/[code]/join/route.ts:75-84` |
| Low | LiveKit token stored in `sessionStorage` (XSS-exfiltratable) | `src/lib/room-session.ts:30-39` |
| Info | No CSRF token, relying on same-origin + JSON content-type preflight | `src/app/api/rooms/route.ts`, `src/app/api/rooms/[code]/join/route.ts` |
| Info | Room code appears in URL path (Referer leak on cross-origin) | `src/app/room/[code]/page.tsx` |
| Info | DRM-dismissal state in `localStorage` — pre-dismissable via XSS | `src/app/page.tsx:21` |
| Info | `POST /api/rooms` silently ignores the nickname the client sends | `src/app/api/rooms/route.ts` |

---

### High — No HTTP security headers on any route

**Location:** `next.config.ts` (no `headers()` configured), affects every
route including `/room/[code]`.

**Description.** The Next.js config exposes no security headers. There
is no `Content-Security-Policy`, no `X-Frame-Options` /
`frame-ancestors`, no `Referrer-Policy`, and no `Permissions-Policy`.

Concrete concerns this leaves open:

1. **Clickjacking of the room page.** `/room/[code]` requests camera +
   mic. Modern browsers require a `Permissions-Policy` / `allow=…`
   attribute on the iframe for `getUserMedia` inside a frame, which
   closes the "trick the user into granting mic" attack in practice.
   But the room page also renders **Leave** and **Copy code** buttons,
   and framing it into a malicious page to phish clicks is nothing the
   app currently defends against. `X-Frame-Options: DENY` (or
   `frame-ancestors 'none'` in CSP) closes this.
2. **Referrer leak of room code.** The room code lives in the URL path.
   Default browser policy is `strict-origin-when-cross-origin`, which
   strips the path on cross-origin requests — so this is largely a
   non-issue today. Setting the header explicitly (`no-referrer` or
   `same-origin`) makes the guarantee explicit and survives a browser
   default change.
3. **XSS blast radius.** Nickname is currently rendered as a React
   text node so it cannot execute script. But if any future addition
   (chat, richer participant UI, an emoji picker rendering HTML)
   introduces an XSS, the LiveKit token sitting in `sessionStorage`
   and the DRM dismissal flag in `localStorage` are readable. A
   default-deny CSP with `script-src 'self'` is the standard mitigation.

**Recommendation.** Add a `headers()` block to `next.config.ts` covering
every route:

- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Content-Type-Options: nosniff`
- `Permissions-Policy: camera=(self), microphone=(self), display-capture=(self)` — restricts these powerful APIs to the top-level origin.
- A conservative `Content-Security-Policy` is worth adding but requires
  care around the LiveKit websocket URL and the Next.js runtime (`connect-src` needs `wss://*.livekit.cloud` — or read from env if you want a tighter allowlist). Ship the four headers above first; CSP as a follow-up if it needs iteration.

**Status:** Fixed in this review — see `next.config.ts` patch below.

---

### Medium — `x-forwarded-for` first-hop trust is a deployment-portable footgun

**Location:** `src/app/api/rooms/route.ts:36-45`,
`src/app/api/rooms/[code]/join/route.ts:59-65`.

**Description.** `clientKey()` reads `x-forwarded-for` and takes the
first comma-separated entry. On Vercel Production this is documented
platform behaviour: the true client IP is the first entry, subsequent
entries are downstream proxies, and client-supplied XFF values are
appended after the true IP. On a self-hosted Node deploy behind a
different proxy, on `next dev` locally, or on any deploy where the
platform edge does not normalize XFF, the client can send
`X-Forwarded-For: 1.2.3.4` and defeat the rate limiter one request at a
time.

The code comment already flags this ("we trust it because we run behind
Vercel's edge; on a self-hosted deploy behind an untrusted proxy this
would be spoofable"). The concern is deployment portability: nothing
enforces "only Vercel" and a future deploy target changes the trust
model silently.

**Recommendation.** Prefer Vercel's per-request `x-real-ip` header (set
by the edge, not the client) or `ipAddress(request)` from
`@vercel/functions`. Both make the trust anchor explicit. Fall back to
XFF first-entry only when the primary is missing. Additionally, hash
the IP before using it as a bucket key so the raw address never lives
in process memory (it already does when logged via `hashForLog`; hash
at `clientKey()` for symmetry).

Not fixed in this review — reasonable one to leave to the next iteration
and would benefit from a quick check of the current Vercel platform
docs; changing the rate-limit key shape can also invalidate in-flight
buckets on the next deploy which is worth doing during a quiet window.

---

### Medium — Rate-limiter fallback fingerprint is trivially rotated

**Location:** `src/app/api/rooms/route.ts:42-44`,
`src/app/api/rooms/[code]/join/route.ts:63-64`.

**Description.** When `x-forwarded-for` is absent, `clientKey()` falls
back to `sha256(user-agent + "\n" + accept-language)`. Any attacker
running curl or a custom HTTP client can rotate the UA header per
request and get a fresh rate-limit bucket every call.

On Vercel Production this fallback is effectively unreachable (the
platform sets XFF), so the concern is bounded. On `next dev` or a
self-hosted deploy without XFF, the rate limiter provides no
protection.

**Recommendation.** In the fallback path, log a warning ("no client IP
resolvable — rate-limit degraded to per-instance shared bucket") and
either (a) use a single shared bucket key like `fp:unknown` so the
whole shared-fingerprint population contends for the same slot, or
(b) `429` the request outright if the deployment is expected to always
have a client IP. Option (a) is the simpler safe default.

---

### Medium — Nickname sanitization does not strip Unicode format / bidi characters

**Location:** `src/app/api/rooms/[code]/join/route.ts:39-46`.

**Description.** `sanitizeNickname()` strips C0 (0x00-0x1F, 0x7F) and
C1 (0x80-0x9F) controls, then trims/collapses whitespace and caps at
20 chars. It does **not** strip:

- **RTL override (U+202E)** — flips subsequent characters right-to-left. A
  nickname `"sam‮evil"` renders as `"samlive"` visually
  (approximately), enabling display-spoofing of other participants.
- **Zero-width joiner (U+200D)**, zero-width space (U+200B), zero-width
  non-joiner (U+200C) — enable invisible padding, hidden characters,
  and lookalike names that appear identical to another participant.
- **Bidi marks (U+200E, U+200F)** — LRM/RLM, similar concern to
  U+202E at a smaller scale.

Nickname is rendered by React as a text node, so this is not XSS —
scripts cannot execute. The concrete risk is **social engineering
inside a room**: a hostile joiner impersonates the host's tile label,
or hides a "kick me" character in their name. In a 4-person MVP where
everyone already knows each other, this is very low real-world impact,
which is why it's Medium and not High.

**Recommendation.** Extend `sanitizeNickname()` to strip U+2028, U+2029,
and the U+200B–U+200F + U+202A–U+202E ranges. A single additional
`.replace()` call. Consider normalizing NFC first
(`raw.normalize("NFC")`) to defeat combining-character noise like
"á́́…" that renders as many stacked accents.

---

### Medium — Nickname length is measured in UTF-16 code units, not grapheme clusters

**Location:** `src/app/api/rooms/[code]/join/route.ts:44`.

**Description.** The 1..20 length gate uses JavaScript `.length`, which
counts UTF-16 code units. A single family emoji ZWJ sequence like
`👨‍👩‍👧‍👦` is 11 code units, so up to ~1 large emoji fits. Conversely, a
20-character emoji nickname would blow the layout on other clients.
This is primarily a UI/consistency finding but has a minor abuse angle:
a nickname full of combining characters can bloat the display beyond
what other participants expect.

**Recommendation.** Either (a) use `Intl.Segmenter` with `granularity:
"grapheme"` to count grapheme clusters, or (b) accept the current
behaviour and document that "20 chars" means "20 code units, so ~10
CJK / ~1 family-emoji". Option (b) is fine for W-MVP; option (a) is
cleaner if the frontend adopts a live grapheme counter next to the
nickname input.

---

### Low — `createRoom` retry loop treats every error as a collision, amplifying LiveKit outages

**Location:** `src/app/api/rooms/route.ts:70-100`.

**Description.** The comment correctly notes that LiveKit's
`createRoom` is idempotent — a name collision returns the existing room
rather than an error. The retry loop therefore only fires on **real
failures** (network, LiveKit 5xx, auth). Retrying up to 5x on a real
LiveKit outage amplifies traffic to LiveKit by up to 5x per client
request; combined with the caller retrying via the UI, that's the
classic thundering-herd amplification during a partial outage.

**Recommendation.** Distinguish "collision-like" errors from
"upstream-unhealthy" errors. Only retry on the specific gRPC/HTTP
status that indicates a name collision (in practice, none — remove the
loop entirely and keep a single attempt). If a retry is kept for
defence in depth, cap it at 1 retry and add a small jitter.

---

### Low — Host-side `setName` bypasses the server-side nickname sanitizer

**Location:** `src/app/room/[code]/RoomClient.tsx:172-176`.

**Description.** On host connect, the client calls
`r.localParticipant.setName(session.nickname)`. `session.nickname`
comes from client-side state; the server never sanitized it because
`POST /api/rooms` ignores the body entirely. The client-side cap
(`nickname.trim().slice(0, NICKNAME_MAX)`) is easily bypassed by
opening devtools and calling `setName("<anything>")` directly.

Impact: a host can put a nickname with control chars, RTL overrides, or
> 20 chars into their own tile label. Since the host controls the room
already, this is close to zero real risk — they could screen-share
malicious content just as easily.

**Recommendation.** Either (a) accept the join-token endpoint for the
host too and mint their token with the sanitized name embedded (drop
`setName` client-side), or (b) sanitize `session.nickname` on the way
into `setName` using the same rules as the server. Option (a) is
strictly better and makes the two flows symmetric.

---

### Low — 400 `invalid_code` is returned before rate-limit check

**Location:** `src/app/api/rooms/[code]/join/route.ts:75-84`.

**Description.** A malformed code (fails the alphabet regex) skips the
rate-limit check. A hostile client can hammer
`POST /api/rooms/!!!!!!/join` at unlimited rate — each request costs a
regex evaluation plus a Zod parse (nanoseconds), so the CPU cost is
trivial. Vercel platform-level DDoS sits in front.

**Recommendation.** Move the code-shape check after the global per-IP
rate-limit check; the global cap (30/min/IP) then bounds even malformed
traffic. Keep the per-(IP, code) check where it is so the check depends
on a validated code. Small reorder, no new logic.

---

### Low — LiveKit token stored in `sessionStorage` (XSS-exfiltratable)

**Location:** `src/lib/room-session.ts:30-39`.

**Description.** The token is stashed in `sessionStorage` under
`session:room:<code>`. Any script running on the same origin can read
it and post it elsewhere. This is standard practice; the mitigation is
that the token TTL is 10 minutes and its grant is room-scoped, so an
exfiltrated token is only useful inside that one room's remaining life.

**Recommendation.** Keep as-is for W-MVP — the CSP added in the High
finding above is the real defence. If W-MVP ever gains a chat surface,
move the token to an httpOnly cookie (accepting the CSRF trade-off) or
reduce TTL further.

---

### Info — No CSRF token, relying on same-origin + JSON content-type preflight

**Location:** `src/app/api/rooms/route.ts`,
`src/app/api/rooms/[code]/join/route.ts`.

**Description.** Both routes are POST with `content-type: application/json`
and no cookies. A cross-origin `fetch()` with `application/json` triggers
a CORS preflight; since neither route sends `Access-Control-Allow-Origin`,
the browser blocks the response — cross-site POST is closed by default.
No token is needed for W-MVP.

**Recommendation.** Do not add CORS `Allow-Origin: *` casually. If a
first-party mobile app or a browser extension is ever added, revisit
with a per-origin allowlist.

---

### Info — Room code appears in URL path (Referer leak on cross-origin)

**Location:** `src/app/room/[code]/page.tsx`.

**Description.** The room code is in the URL path. Modern browsers
default to `strict-origin-when-cross-origin`, so the path is stripped
on any cross-origin request from the room page (Referer becomes just
`https://your-host.example`). This is effectively safe today.

**Recommendation.** Set `Referrer-Policy: strict-origin-when-cross-origin`
explicitly (handled by the High finding above).

---

### Info — DRM-dismissal state in `localStorage` — pre-dismissable via XSS

**Location:** `src/app/page.tsx:21` (`DRM_DISMISS_KEY`).

**Description.** An XSS write could pre-dismiss the DRM notice, making
subsequent legitimate users skip the warning. Low value target — the
attacker would have already achieved script execution to do worse
things.

**Recommendation.** No change needed; note as an accepted risk.

---

### Info — `POST /api/rooms` silently ignores the nickname the client sends

**Location:** `src/app/api/rooms/route.ts`.

**Description.** The landing page sends `{ nickname }` on create. The
server does not parse or use it. The comment in `CreateCard` calls this
out as forward-compatible. Consequence: the host's token has no `name`
claim, and `RoomClient` compensates with `setName` client-side (see
"Host-side `setName` bypasses…" above).

**Recommendation.** Either accept `nickname` server-side on
`POST /api/rooms` and mint the token with `name` set (removing the
client-side `setName` divergence — my preferred fix), or delete the
`nickname` field from the client request to avoid the appearance of
server-side validation that isn't happening.

---

## Explicitly accepted risks (do not re-flag)

These are called out in the ADR / PM spec and are **not** findings —
they are intentional MVP trade-offs. Recording them here so a future
review doesn't rediscover them as "new".

1. **Room code is the sole capability token.** ADR 0004 explicitly locks
   this in. No host approval, no per-participant kick, no moderation.
   Anyone with the code is a peer.
2. **Host can share any tab, including sensitive tabs.** No warning about
   sharing an entire desktop vs a tab; the browser's own picker is the
   only gate. Out of scope for the app.
3. **In-process `Map`-based rate limiter.** ADR 0004 accepts this as
   MVP tech debt with a trigger for migrating to Vercel KV / Upstash
   Redis (same trigger as the M1/M2 discover-route limiter).
4. **6-char code + rate-limit envelope withstands ≤ 100 concurrent rooms.**
   ADR 0004 explicitly does the entropy math and picks the retry / TTL
   / limits to match. Live-room fraction ≈ 1 in 8.9M; per-(IP, code)
   limit of 5/min plus 30/IP/min globally makes brute-forcing a
   specific live room infeasible for a single-IP attacker and slow for
   a small botnet. Revisit when concurrent-rooms exceeds ~10k or when
   a real abuse signal surfaces.
5. **Token in `sessionStorage`.** See the Low finding — accepted for
   W-MVP behind CSP.
6. **No `beforeunload` prompt.** PM explicit decision (fewer surprises,
   matches disposable posture).
7. **`canPublishData: false`, `canPublish: true` for all participants.**
   Host-only screen-share is a UI gate, not a token gate. ADR 0004
   §"LiveKit token — scope + TTL" documents the upgrade path if abuse
   is observed.

---

## Not covered by this review

- **Dependency vuln audit.** `npm audit` was not run. Recommend running
  it in CI and gating merges on any High/Critical, especially for
  `livekit-client` / `livekit-server-sdk` and `next` — WebRTC and
  server-side crypto are the biggest surfaces.
- **LiveKit Cloud account posture** (API-key rotation policy, allowed
  origins, room-service ACLs). Out of scope for a diff review of the
  shipped code; owned by DevOps per ADR 0004 open questions.
- **Runtime observability.** No Sentry / structured logging in place —
  known, tracked in `docs/architecture/tech-debt.md`. Not a security
  finding per se, but silent failures degrade the ability to notice an
  abuse pattern early.

---

## In-review fixes

Applied in this review (one file changed):

- `next.config.ts` — added a `headers()` block returning a minimal
  security-header set (`X-Frame-Options`, `Referrer-Policy`,
  `X-Content-Type-Options`, `Permissions-Policy`) for every route.
  Closes the High finding. Left CSP off for now (needs LiveKit
  websocket allowlist tuning per environment); documented as follow-up.
