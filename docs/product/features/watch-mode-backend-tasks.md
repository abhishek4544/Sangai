# Watch Mode v1.1 — Backend Implementation Task Spec

**Status:** Planning
**Milestone:** W-1.1 (starts after W5 review passes on the base MVP)
**Author:** Backend tech-lead
**Depends on:** ADR 0006, ADR 0005 §1 (envelope + data channel), W-MVP live in prod.

---

## Scope summary

ADR 0006 is explicit: Watch Mode adds no API routes, no DB, no Redis. The
server-side surface is four items: one pre-existing token grant (already
correct — see W-1.1-B1), one new pure-function validator, one CSP extension
that is currently a pre-req gap, and envelope schema additions. Everything
else is client-side.

---

## W-1.1-B1 — Token grant audit: `canPublishData`

**File to touch:** `src/lib/livekit/token.ts` — no change required.

**Description.** PM open-question #1 (watch-mode-mvp.md §"Open questions")
asked whether `canPublishData` needed to be flipped for Watch Mode. It was
already flipped. ADR 0005 §8 upgraded the grant to `canPublishData: true` and
`canUpdateOwnMetadata: true`; `src/lib/livekit/token.ts` reflects this today.
Watch Mode rides the same data channel as Phase-2 features with no further
token change. This task is a verification step, not an implementation step.

**Acceptance criteria.**

- Confirm `mintAccessToken` in `src/lib/livekit/token.ts` contains
  `canPublishData: true`. It does. No edit required.
- Add a one-line comment referencing ADR 0006 alongside the existing ADR 0005
  §1 reference so the rationale stays co-located with the code.
- Confirm the token test suite in `src/lib/livekit/token.test.ts` asserts the
  grant object. If the test does not assert `canPublishData`, add the
  assertion in this PR so there is no regression path.

**Test coverage.** Existing unit tests in `src/lib/livekit/token.test.ts`.
Add grant-field assertion if absent. No new test file needed.

---

## W-1.1-B2 — New file: `src/lib/watch/validate-url.ts`

**File to touch:** New file — `src/lib/watch/validate-url.ts`.

**Description.** Pure function, no I/O, importable from both server and client
code (no `"server-only"` guard — it contains no secrets and must run client-
side before a `watch/load` publish). The function enforces the URL allowlist
and blocks dangerous or SSRF-adjacent inputs before anything reaches the data
channel or the iframe. It is the canonical home for the "is this URL Watch
Mode can handle" question; all callers (client-side `<WatchPanel />`, and any
future server-side preflight route) import from here.

**Contract.**

```ts
export type ValidateResult =
  | { ok: true;  providerId: string; mediaId: string }
  | { ok: false; reason: string };

export function validateWatchUrl(input: string): ValidateResult
```

Return type is a Zod-inferred shape; define the schema and derive the type
from it so callers get runtime validation for free.

**Validation rules (in order; reject at first failure).**

1. Length cap: reject if `input.length > 2048`.
2. Parse with `new URL(input)`; reject if it throws.
3. Protocol: reject anything other than `https:`. In `NODE_ENV === "development"`
   also allow `http:` for local testing — gated explicitly, not implicit.
4. Explicit protocol blocklist (belt-and-braces): reject `javascript:`,
   `data:`, `file:`, `blob:` even though step 3 already covers them.
5. Host blocklist — reject RFC1918, loopback, and link-local addresses to
   prevent SSRF-style embeds pointing at intranet services:
   - Exact hostnames: `localhost`, `ip6-localhost`, `ip6-loopback`.
   - Suffix: `.local`.
   - IPv4 CIDR ranges checked by string prefix or parsed integer:
     `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`,
     `169.254.0.0/16` (link-local).
   - IPv6: `::1`, prefix `fc00::` (ULA, covers `fc00::/7`), prefix `fe80::`
     (link-local).
6. Provider match: call `detectProvider(url)` (from `src/lib/watch/detect-provider.ts`).
   If `null`, return `{ ok: false, reason: "unsupported_provider" }`.
7. Media ID extraction: call `provider.extractMediaId(url)`. If `null`,
   return `{ ok: false, reason: "unrecognized_url_shape" }`.
8. On success: return `{ ok: true, providerId: provider.id, mediaId }`.

**Day-one YouTube URL shapes accepted (PM open-question #3 — confirmed exhaustive for v1.1).**

| Shape | Example |
|---|---|
| Standard watch | `https://www.youtube.com/watch?v=dQw4w9WgXcQ` |
| Short link | `https://youtu.be/dQw4w9WgXcQ` |
| Shorts | `https://www.youtube.com/shorts/dQw4w9WgXcQ` |
| Embed form | `https://www.youtube.com/embed/dQw4w9WgXcQ` |
| Mobile subdomain | `https://m.youtube.com/watch?v=dQw4w9WgXcQ` |

**YouTube host allowlist** (used by the YouTube provider's `matches()` —
documented here so the security reviewer has a single place to audit):
`www.youtube.com`, `youtube.com`, `m.youtube.com`, `youtu.be`,
`youtube-nocookie.com`. The host check in `validate-url.ts` is
provider-agnostic (it checks the blocklist only, not the allowlist); the
allowlist enforcement is inside each provider's `matches()`. This keeps the
two concerns separate: `validate-url.ts` blocks dangerous hosts,
`detect-provider.ts` allows known-good ones.

**Rejection reason strings** (used as structured log fields and UI copy
keys — do not localize in this layer):
`"too_long"`, `"invalid_url"`, `"protocol_not_https"`, `"dangerous_protocol"`,
`"blocked_host"`, `"unsupported_provider"`, `"unrecognized_url_shape"`.

**Acceptance criteria.**

- `validateWatchUrl("https://www.youtube.com/watch?v=abc123")` returns
  `{ ok: true, providerId: "youtube", mediaId: "abc123" }`.
- `validateWatchUrl("http://localhost/evil")` returns `{ ok: false, reason: "blocked_host" }`.
- `validateWatchUrl("javascript:alert(1)")` returns `{ ok: false, reason: "protocol_not_https" }`.
- `validateWatchUrl("https://www.netflix.com/watch/12345")` returns
  `{ ok: false, reason: "unsupported_provider" }`.
- `validateWatchUrl("https://10.0.0.1/internal")` returns
  `{ ok: false, reason: "blocked_host" }`.
- All five accepted YouTube shapes above return `ok: true`.
- The embed form (`/embed/dQw4w9WgXcQ`) and short link (`youtu.be/...`) return
  the same `mediaId` as the standard watch form — normalization is in
  `extractMediaId`, not in the validator.
- Function is pure: no I/O, no side effects, no module-level state.

**Test coverage.** New unit test file `src/lib/watch/validate-url.test.ts`.
Tests run in Vitest with no DOM dependency. Cover: all rejection reason codes
with at least two examples each; all five accepted YouTube shapes; IPv4 and
IPv6 blocklist entries; the `NODE_ENV=development` `http:` bypass path.

---

## W-1.1-B3 — Envelope schema: `watch/*` event types

**File to touch:** `src/lib/room/envelope.ts`.

**Description.** ADR 0006 defines six new envelope types that Watch Mode
publishes over the existing data channel. They must be added to the
`RoomEventSchema` union and exported as named types so `useWatchSync` and the
late-joiner snapshot path can import them with the same Zod-validated,
type-safe pattern used by every other Phase-2 event.

**New schemas to add** (all carry `v: z.literal(1)` and
`ts: z.number().int().nonnegative()` per the existing pattern):

| Schema name | `type` literal | Key fields | Reliability |
|---|---|---|---|
| `WatchLoadSchema` | `"watch/load"` | `providerId: string(1–64)`, `mediaId: string(1–128)`, `controllerId: string(1–128)` | RELIABLE |
| `WatchPlaySchema` | `"watch/play"` | `positionSec: number (≥0)`, `controllerId: string(1–128)` | RELIABLE |
| `WatchPauseSchema` | `"watch/pause"` | `positionSec: number (≥0)`, `controllerId: string(1–128)` | RELIABLE |
| `WatchSeekSchema` | `"watch/seek"` | `positionSec: number (≥0)`, `controllerId: string(1–128)` | RELIABLE |
| `WatchHeartbeatSchema` | `"watch/heartbeat"` | `positionSec: number (≥0)`, `controllerId: string(1–128)` | LOSSY |
| `WatchStopSchema` | `"watch/stop"` | `controllerId: string(1–128)` | RELIABLE |

`WatchStopSchema` is needed to broadcast "Watch Mode ended" to all peers —
ADR 0006 describes the stop flow (AC6) but omits an explicit envelope type
for it. Include it rather than reusing `watch/load` with an empty payload;
explicit types are cheaper than ambiguity at the receiver.

**`HelloSchema` snapshot extension.** The `hello/snapshot` payload must gain
an optional `watchState` field so a late joiner can catch up on first render
without a second round-trip (ADR 0006 §"Late-joiner handshake"). Add:

```ts
watchState: z.object({
  providerId: z.string().min(1).max(64),
  mediaId:    z.string().min(1).max(128),
  playbackState: z.enum(["playing", "paused"]),
  positionSec:   z.number().nonnegative(),
  updatedAt:     z.number().int().nonnegative(),
  controllerId:  z.string().min(1).max(128),
}).nullable().optional()
```

`nullable()` — Watch Mode may not be active when a peer joins. `.optional()`
— peers who have not updated to v1.1 yet omit the field; joiner treats
absence the same as `null` (no Watch Mode active). This follows the exact
pattern already used by `backgroundId` and `activeGame` in the same schema.

**Exported types.** Add named exports for each new schema type so callers
import the Zod-inferred type, not a hand-written interface:
`WatchLoadEvent`, `WatchPlayEvent`, `WatchPauseEvent`, `WatchSeekEvent`,
`WatchHeartbeatEvent`, `WatchStopEvent`.

**Acceptance criteria.**

- `decodeEvent(encodeEvent({ v:1, ts: Date.now(), type: "watch/load", providerId: "youtube", mediaId: "abc", controllerId: "uuid" }))` round-trips without returning `null`.
- A payload with `type: "watch/heartbeat"` and a negative `positionSec` returns `null` from `decodeEvent`.
- The `hello/snapshot` schema accepts a payload with `watchState: null` and one with a fully-populated `WatchState` object.
- Adding the six new schemas does not break any existing `decodeEvent` test — the union is additive.

**Test coverage.** Extend `src/lib/room/envelope.test.ts`. Add round-trip
tests for each new schema; add a malformed-`positionSec` rejection test;
add `hello/snapshot` with and without `watchState`. No new test file needed.

---

## W-1.1-B4 — CSP `frame-src` allowlist (pre-req gap)

**File to touch:** `next.config.ts`.

**Description.** `next.config.ts` currently sets `X-Frame-Options`, `Referrer-Policy`,
`X-Content-Type-Options`, and `Permissions-Policy` on every route. The inline
comment at line 28 explicitly defers CSP: "worth adding, but the LiveKit
websocket URL varies per environment and Next.js's inline runtime scripts
need either `'unsafe-inline'` or a per-request nonce." Watch Mode adds an
iframe to the room page; without a `Content-Security-Policy: frame-src`
directive the browser falls back to `default-src`, and if that is absent
(it currently is), the browser allows all frame origins — which is only
safe by accident. Adding Watch Mode without CSP means the security posture
degrades the moment a future default-src is added. CSP must be established
before or alongside Watch Mode, not after.

**Pre-req task (blocks W-1.1-B4 proper).** Before Watch Mode ships, add a
minimal `Content-Security-Policy` header to `next.config.ts`. The minimum
viable CSP for the room page is:

```
default-src 'self';
script-src 'self' 'unsafe-inline' https://www.youtube.com;
frame-src 'none';
connect-src 'self' wss://*.livekit.cloud;
img-src 'self' data: https://image.tmdb.org;
media-src 'self' blob:;
```

`'unsafe-inline'` on `script-src` is a temporary concession to Next.js's
inline runtime chunk; replace with a per-request nonce when the app moves to
a route-handler-based nonce pattern (tracked as tech debt — same entry as
the existing CSP deferral note in `next.config.ts`).

**Watch Mode `frame-src` addition.** Once the baseline CSP is in place, add:

```
frame-src https://www.youtube.com https://www.youtube-nocookie.com;
```

This replaces the `frame-src 'none'` line from the baseline above. The
`youtube-nocookie.com` origin is preferred for embeds (no YouTube cookie
tracking); `www.youtube.com` is required as a fallback because the IFrame
API's `postMessage` origin varies by player state.

**Note on `X-Frame-Options: DENY`.** This header is already set globally.
It governs whether *this app* can be framed by a third-party page, not
whether *this app* can frame others. Leave it in place; it is not in tension
with adding `frame-src`.

**Provider expansion rule.** Every future provider PR must add its embed
origin to `frame-src` as part of the same PR. The CSP diff is a required
review gate per ADR 0006 §"Security defaults". Document this in the
PR template or checklist.

**Acceptance criteria.**

- `next.config.ts` emits a `Content-Security-Policy` header on every route
  (verify with `curl -I http://localhost:3000` in CI).
- The header includes `frame-src https://www.youtube.com https://www.youtube-nocookie.com`.
- The room page (`/room/[code]`) loads the YouTube IFrame API without a CSP
  violation in the browser console.
- A `<iframe src="https://www.evil.com/...">` inserted into the room page is
  blocked by the browser with a CSP violation, not silently allowed.
- `X-Frame-Options: DENY` remains present on all routes.

**Test coverage.** No unit tests apply. Verified manually and in the QA E2E
pass: open browser devtools, confirm zero CSP errors during a Watch Mode
session. Add the CSP header value to the security-review checklist in
`docs/architecture/security-review-watch-together-mvp.md` for the v1.1
security review.

---

## W-1.1-B5 — Rate-limit posture: server-side fallback lever

**File to touch:** No file changes in v1.1. Spec only.

**Description.** ADR 0006 caps client-side Watch Mode publishes at
≤ 10 events/sec/participant via a leaky-bucket in `useWatchSync`. The
backend has no role in enforcing this for v1.1 because sync is entirely
peer-to-peer over the LiveKit data channel — there is no server routing
individual `watch/*` packets.

If client-side abuse becomes real (a participant publishing a flood that
degrades the room for peers), the fallback lever is the LiveKit RoomService
participant-kick API: `roomService.removeParticipant(roomName, identity)`.
The module that would own this is `src/lib/livekit/room-service.ts`, which
already wraps `RoomServiceClient`. A `kickParticipant(code, identity)` export
would be a three-line addition to that file.

This is **not scoped for v1.1**. The trigger for building it is an observed
abuse pattern that client-side rate limiting fails to contain. Document the
trigger and the file location here so no future ADR is needed to "discover"
the path.

**Acceptance criteria.** None — this is a forward reference, not an
implementation task.

**Test coverage.** None in v1.1.

---

## W-1.1-B6 — Env-var schema: no changes required

**File to touch:** `src/lib/env.ts` — no change required.

**Description.** ADR 0006 adds no new environment variables. `LIVEKIT_URL`,
`LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` are already validated by the Zod
schema in `src/lib/env.ts`. The YouTube IFrame API is loaded client-side by
inserting a `<script>` tag in a component effect; it is a public CDN URL, not
a key. No secrets, no new config.

**Acceptance criteria.** Confirm `src/lib/env.ts` schema requires no amendment.
If a future provider requires an API key (e.g. a Vimeo embed that needs a
per-domain player key), that key goes here with the same `z.string().min(1)`
shape and a `server-only` guard. Document the pattern in this file's comment
block when that day comes.

---

## Non-goals for v1.1 backend

The following are explicitly out of scope. If they appear in a PR review,
flag as scope creep.

- **Persisting watch state.** No DB row, no KV entry, no room-metadata write
  for the current `WatchState`. LiveKit room lifecycle is the scope boundary;
  if the room dies, Watch Mode history dies with it.
- **Server-side URL preflight route** (`POST /api/watch/preflight` or similar).
  `validate-url.ts` is server-safe and importable from a route handler, but
  no such route ships in v1.1. Add only if server-side analytics or a shared
  block list becomes a requirement.
- **Per-room playback analytics.** No counters, no "Watch Mode minutes" metric
  collected server-side. Success metrics in the PM doc are measured by
  product instrumentation outside this codebase.
- **Server-enforced rate limiting on data-channel events.** LiveKit's SFU
  forwards data-channel payloads without server-side inspection at our tier.
  Client-side leaky-bucket is the only enforcer in v1.1.
- **Provider-specific API calls from the server.** The YouTube IFrame Player
  API is a browser-side SDK; no YouTube Data API calls originate server-side
  in v1.1.
- **Age-gate / region-lock preflight.** YouTube will refuse to render
  embed-disabled or region-locked videos in the IFrame Player. The failure
  surfaces client-side via the player's `onError` callback. No server-side
  detection or pre-screening is scoped.
- **Token role differentiation** (host vs. guest grant). All participants
  receive the same token grant for v1.1. "Anyone can drive" (US2) is the
  product posture; server-enforced role gates require a different grant shape
  and a new ADR.
- **LiveKit participant kicking for Watch Mode abuse.** Identified in W-1.1-B5
  as the future fallback lever; not implemented in v1.1.

---

## Open questions requiring resolution before implementation starts

1. **CSP nonce strategy.** W-1.1-B4 accepts `'unsafe-inline'` on `script-src`
   as a temporary measure. Before v1.1 ships to production, the tech lead
   must confirm whether a nonce-based approach is feasible in the current
   Next.js App Router configuration, or whether `'unsafe-inline'` is the
   accepted interim posture with a tracked debt entry. This gates the CSP
   pre-req subtask.

2. **`hello/snapshot` backward compatibility window.** W-1.1-B3 adds
   `watchState` as an optional field to the snapshot payload. Peers running
   the pre-v1.1 code will omit it; peers running v1.1 will include it. Since
   there is no negotiation round-trip, both directions must be safe on day
   one. Confirm: (a) the `.optional()` guard is sufficient, and (b) no
   live-reload or blue/green deployment scenario can leave two peers on
   mismatched schema versions in the same room long enough to matter.
   Given the 10-minute idle grace on rooms this is low risk, but it should
   be explicitly signed off in the code review.

3. **`WatchStopSchema` vs. UI-local stop.** ADR 0006 AC6 says "the player is
   removed from every participant's UI within 2 seconds" when any participant
   stops Watch Mode. The envelope needs a broadcast for that. W-1.1-B3
   includes `WatchStopSchema` (`type: "watch/stop"`). Confirm with the
   frontend specialist that this is the right shape (not, e.g., a `watch/load`
   with an empty `mediaId`) before the envelope PR is merged, to avoid a
   schema revision mid-sprint.
