# ADR 0004 — W-MVP: Watch-together on LiveKit Cloud, no DB

**Status:** Accepted
**Date:** 2026-09-04
**Milestone:** W-MVP (post-pivot; supersedes the M3–M5 active path)

## Context

`CLAUDE.md` was pivoted on 2026-09-04. The active MVP is no longer the
movie-recommender; it is a **watch-together room**: host creates a room,
gets a short shareable code, friends join anonymously with a nickname,
everyone gets voice + video, and the host can screen-share a browser tab
**with its audio** (YouTube / Twitch / X clips / live sports — any
non-DRM surface). The full product ACs live in
`docs/product/features/watch-together-mvp.md`; this ADR is the
architecture for shipping them.

Three things constrain the design.

1. **No DRM.** Netflix / Prime / Disney+ / HBO Max render as a black
   frame on the guest side. This is a browser DRM restriction, the PM
   spec makes it explicit (AC7), and no architecture we could pick
   changes it. The room is for non-DRM playback.
2. **Zero-friction join.** No accounts, no email verification, no
   extensions. The room code is the **only** capability token, per
   `CLAUDE.md`. Anyone with the code is a peer.
3. **Free-tier feasible.** No per-hour compute cost. The user is testing
   with a partner and 1–3 friends, not running a paying product yet.

Two paths were considered against those constraints before this ADR was
written and both were ruled out at the product-decision stage — they are
recorded in _Alternatives considered_ so the reasoning is not lost:
Hyperbeam (cloud co-browser, DRM-capable but per-hour compute cost that
does not fit the MVP posture) and hand-rolled WebRTC + coturn (TURN
infra, signaling, reconnection, and browser-quirk handling are all
solved problems and shipping them ourselves buys nothing for the MVP).

## Decision

Build the W-MVP on **LiveKit Cloud** for all media (SFU, TURN,
screen-share-with-audio, voice), with a **stateless Next.js serverless
token mint** on Vercel and **no database**. LiveKit itself is the source
of truth for room existence.

The rest of this section enumerates the pieces.

### What runs where

| Layer | Where | Why |
|---|---|---|
| SFU + TURN + signaling | LiveKit Cloud | One managed service. Do not hand-roll. |
| Token mint (`POST /api/rooms`, `POST /api/rooms/[code]/join`) | Next.js API routes on Vercel, **Node.js runtime** | LiveKit server SDK requires Node crypto APIs; Edge runtime is not sufficient. Also stateless, so serverless is the right shape (no always-on process needed). |
| LiveKit client (`livekit-client`) | Browser, **lazy-loaded on `/room/[code]` only** | Do not ship the SDK on `/`. `CLAUDE.md` engineering standards call this out. |
| Landing page (`/`) | Next.js server component / minimal client component | Two buttons + a form. No LiveKit SDK on this route. |
| Room UI (`/room/[code]`) | Next.js client component | Owns the LiveKit `Room` instance, tile layout, share-tab control. |

No Redis, no Postgres, no Socket.IO, no long-running host, no
background jobs. If any of those show up, the ADR needs an amendment.

### API surface — two routes, minimal shapes

Both routes are Node runtime (`export const runtime = "nodejs"`), both
are stateless, both validate input with Zod, and neither returns any
LiveKit secret to the browser (only the short-lived join token).

**`POST /api/rooms` — create a room**

Purpose: generate a code, ensure a corresponding LiveKit room exists,
mint the host's join token.

Request body (Zod-validated):
- `nickname: string` — 1..20 chars after control-char strip; display-only.

Response (200):
- `code: string` — the 6-char room code (see _Room code generation_).
- `token: string` — LiveKit AccessToken JWT (see _Token scope + TTL_).
- `url: string` — `LIVEKIT_URL` (public; the client needs it to
  connect). Safe to return; this is not the API secret.

Errors: `429` from rate limiter, `500` if LiveKit RoomService rejects
after N code-collision retries (should be astronomically rare — see the
entropy math below).

**`POST /api/rooms/[code]/join` — join by code**

Purpose: confirm the room actually exists on LiveKit, then mint a
guest's join token. This route does **not** create the LiveKit room —
if the room isn't there, the code is dead.

Path param: `code: string` — 6 chars, validated against the code
alphabet regex.

Request body (Zod-validated):
- `nickname: string` — 1..20 chars after control-char strip.

Response (200):
- `token: string`
- `url: string`

Errors:
- `400` — code fails the alphabet regex.
- `404` — room does not exist on LiveKit (expired, wrong code, or
  never created). Client renders the PM's "That code isn't active"
  copy from AC2.
- `409` — room is at capacity (4 participants, per `CLAUDE.md`
  product decisions). Client renders "This room is full."
- `429` — per-code rate limiter tripped (brute-force guard).

Neither response body includes anything that leaks internal state — no
timestamps of last activity, no participant nicknames, no `sid`. The
join contract is a token or an error, nothing else.

### Room code generation — `crypto.randomBytes`, 6 chars, 31-char alphabet

**Alphabet.** Per `CLAUDE.md`, uppercase alphanumeric excluding the
look-alikes `0`, `O`, `1`, `I`, `L`. That leaves **31 characters**:
`23456789ABCDEFGHJKMNPQRSTUVWXYZ`. Six chars → **31^6 ≈ 887M** distinct
codes.

**Generator.** `crypto.randomBytes(N)` (never `Math.random()`, per
`CLAUDE.md`). Take one byte per code position, reject bytes that would
introduce modulo bias (i.e. draw fresh bytes until each is `< 31 * ⌊256/31⌋ = 31 * 8 = 248`), then map to the alphabet by `byte % 31`.
This yields a uniformly distributed code. Six positions means a tiny
inner loop; the rejection-sampling cost is negligible.

**Collision handling.** On `POST /api/rooms`, generate a code, then use
LiveKit RoomService `createRoom({ name: code, emptyTimeout: 600 })`. If
LiveKit reports the room already exists, generate a new code and retry
(cap 5 retries). With 31^6 ≈ 887M codes and an MVP ceiling of ≤ 100
concurrent rooms, the birthday-collision probability for a single new
code is ≈ 100 / 887M ≈ 1.1e-7 per attempt — five retries is theatre;
one attempt is what will actually happen. But the retry cap makes the
route's worst case bounded, which matters for a serverless handler.

**Brute-force threat model.** A code is a capability token. If an
attacker can guess a live code, they can join the room. With:
- 31^6 ≈ 887,503,681 total codes,
- MVP ceiling of ≤ 100 concurrent live rooms at any moment,
- **10-minute idle grace** TTL after last participant leaves,

the fraction of the code space that is "alive" at any moment is
≤ 100 / 887M ≈ **1 in 8.9 million per guess**. With the per-code
rate limit below (5 join attempts / IP / minute), a single-IP attacker
gets 5 * 60 * 10 = 3,000 attempts inside a 10-minute room lifetime —
expected hits ≈ 3.4e-4. With a small botnet of 100 IPs, expected hits
≈ 3.4e-2 per 10 minutes. That's still "one hit every few hours of
sustained attack against a room they don't know exists". Acceptable for
an MVP with ≤ 100 concurrent rooms and no persisted user data behind
the code.

If room concurrency ever grows past ~10k live rooms (attacker's live
fraction rises to ≈ 1 in 90k) **or** the rate limiter is bypassed at
scale, revisit: either lengthen the code to 7 chars (31^7 ≈ 27B → live
fraction back below 1 in 100M at 10k rooms) or add a short-lived
proof-of-work challenge on `/api/rooms/[code]/join`. Tracked as tech
debt with the trigger.

**Note on the 27 vs 31 alphabet.** The tech-lead brief cited a 27-char
alphabet (27^6 ≈ 387M). Reading `CLAUDE.md`'s exclusion list literally
(`0, O, 1, I, L` — five characters) yields 31, not 27. The 27-char
calculation would require excluding four additional look-alikes (a
common further tightening is `2`/`Z`, `5`/`S`, `8`/`B`, and `6`/`G`).
We adopt **31 chars** because that's what `CLAUDE.md` says. If the
product owner wants the extra typing-legibility margin, tightening to
27 is a one-line alphabet constant change; the entropy is still
comfortable (387M / 100 live rooms ≈ 1 in 3.9M per guess, well inside
the same rate-limit envelope).

### LiveKit token — scope + TTL

Minted with the LiveKit server SDK's `AccessToken`. **Room-scoped, one
identity per token, minimum-necessary grants.**

- `identity`: a per-session UUID (`crypto.randomUUID()`), **not** the
  nickname. The nickname is display-only per `CLAUDE.md`; it goes into
  the token's `name` field (LiveKit exposes it to other participants as
  the participant display name). Duplicate nicknames are allowed; the
  UUID `identity` is what keeps two "sam"s distinct on the wire.
- `ttl`: **10 minutes**. The token only needs to survive from mint to
  `room.connect()`. Once connected, the LiveKit session is what keeps
  the participant in the room; the token is not re-checked on every
  frame. A short TTL means a stolen mint response is only useful for
  10 minutes.
- Grant: `roomJoin: true`, `room: <code>`, `canPublish: true`,
  `canSubscribe: true`, `canPublishData: false`. Nothing else.
  - `canPublish` is what allows both camera/mic and screen-share —
    screen-share is a **source** (`ScreenShare` / `ScreenShareAudio`
    tracks) on the same participant, not a separate grant. The
    "host-only screen share" gate is enforced **in the client UI**
    (only render the button for the room creator's session);
    server-side, everyone technically has publish rights. This is a
    deliberate MVP tradeoff — kick/mute is out of scope per the PM
    spec, and a guest who wanted to publish a screen-share would be
    kicked socially, not by the token. If host-only becomes a real
    requirement, we mint different grants per role (host token with
    `canPublishSources: [camera, microphone, screen_share, screen_share_audio]`,
    guest token with `canPublishSources: [camera, microphone]`).
  - `canPublishData: false` — no data channel in W-MVP (no text chat,
    no playback sync). Turn it on if either lands.

The token is minted server-side using `LIVEKIT_API_KEY` +
`LIVEKIT_API_SECRET` and returned once in the response body. Neither
secret ever reaches the browser.

### How "room exists" is checked without a DB

LiveKit RoomService is the source of truth. Two patterns were on the
table; we pick pattern **A**.

**Pattern A (chosen): create-on-create, check-on-join.**
- `POST /api/rooms`: call `roomService.createRoom({ name: code, emptyTimeout: 600, maxParticipants: 4 })`. The room now exists on
  LiveKit with a 10-minute empty-timeout. `emptyTimeout` is LiveKit's
  own "how long to keep a room alive with zero participants" — which
  is exactly the PM spec's 10-minute idle grace, natively enforced by
  the platform. No cron, no cleanup job, no DB row to expire.
- `POST /api/rooms/[code]/join`: call
  `roomService.listRooms({ names: [code] })`. If the returned array is
  empty, the room has expired or never existed → **404**. If the room
  is present and `numParticipants >= 4`, → **409**. Otherwise, mint the
  guest token.

**Pattern B (rejected): mint-and-let-client-create-on-first-join.**
LiveKit will auto-create a room on the first `room.connect()` if it
doesn't exist. This is simpler — no server-side RoomService call at
all — but it breaks the join semantics: an invalid code would silently
create a fresh empty room named after the typo instead of returning 404.
The PM's AC2 requires "invalid or expired code shows … 'That code isn't
active'". Pattern A gives us that; Pattern B does not.

The one RoomService call per join is ~single-digit ms and inside the
free-tier API budget.

### Rate limiting

Two limiters, both keyed and both stateless-friendly.

- **`POST /api/rooms`** — per-IP token bucket, **10 room creations per
  IP per hour**. Prevents a single client from spamming
  `roomService.createRoom` and either exhausting the LiveKit free-tier
  room quota or filling the code space with dead rooms during their
  10-minute empty-timeout.
- **`POST /api/rooms/[code]/join`** — per-IP-plus-code token bucket,
  **5 attempts per (IP, code) per minute**, and a per-IP global cap of
  **30 join attempts per minute**. The per-(IP, code) bucket is what
  defends the brute-force math above.

**Implementation for the MVP.** Vercel serverless instances are
ephemeral, so an in-process `Map` limiter is per-instance-and-per-cold-
start; that is intentionally weak but is what the M1/M2 tech-debt entry
already accepts for the discover route. We accept the same posture for
W-MVP and track "move rate limiters to a shared store (Vercel KV /
Upstash Redis)" as tech debt with the same trigger as the M2 gems
cache — first public launch, or when a real abuse signal shows up.
Vercel's platform-level DDoS protection sits in front of both routes
in the meantime.

### Environment variables

Three new vars, all server-side, all validated at boot by `src/lib/env.ts`
(extending the existing Zod schema — the pattern is already in the repo
per ADR 0002/0003):

| Var | Shape | Notes |
|---|---|---|
| `LIVEKIT_URL` | `wss://...` URL | Public-ish (the client needs it to connect). Safe to return in `/api/rooms` response. Validate as `z.string().url().startsWith("wss://")`. |
| `LIVEKIT_API_KEY` | non-empty string | **Server-only.** Never returned to the client, never logged. |
| `LIVEKIT_API_SECRET` | non-empty string, min length ≥ 32 | **Server-only.** Never returned, never logged. The min-length check is a smoke test against pasting a placeholder. |

`env.ts` uses `import "server-only"` (already does), which throws at
build time if anything client-side accidentally imports it. Any log
line touching env values must reference the key name only, never the
value.

### Logging

Same posture as M1/M2:
- Structured `console.error` on failure paths with `route`, error class,
  and, for LiveKit errors, the upstream status code. **Never** the API
  key, the API secret, or the token body. Codes may appear in logs
  (they are ephemeral capability tokens; 10 minutes after the room dies
  they carry no value) but treat them the same as an OAuth code — do
  not include in third-party analytics.
- Sentry is still deferred (tracked in `docs/architecture/tech-debt.md`).
  W-MVP does not change that trigger.

## Alternatives considered

- **Hyperbeam (cloud co-browser).** Would give us DRM playback (Netflix /
  Prime / Disney+) because Hyperbeam runs a real browser server-side
  and streams the pixels back. Rejected for MVP: per-hour compute cost
  is inconsistent with the "free-tier feasible" constraint, and the DRM
  case is explicitly a PM non-goal for W-MVP (AC7 warns about it
  upfront). Kept on the table in `CLAUDE.md` if DRM ever becomes a
  requirement.
- **Daily.co / Twilio Video / Agora / Vonage / Jitsi as-a-service.**
  All would functionally work. LiveKit wins on: open-source client SDK
  (no vendor SDK to load on every page — we can lazy-load and audit),
  generous free tier for MVP-scale usage, first-class screen-share-with-
  audio support, and a server SDK that runs cleanly on Node/Vercel.
  Twilio Video is EOL (sunset announced 2024). Daily is comparable but
  we're not moving off LiveKit without a triggering reason.
- **Hand-rolled WebRTC + coturn.** Rejected: TURN infra provisioning,
  signaling server, reconnection semantics, ICE restart, and
  browser-quirk handling are all solved problems. Building them means
  weeks of infra work with zero product differentiation, and TURN alone
  is a full second service to host and monitor. Not the shape of an MVP.
- **Postgres or Redis row for rooms.** Rejected: LiveKit already knows
  every room that exists, its participants, and its expiry timer.
  Adding a DB row means (a) a second source of truth to keep in sync,
  (b) a cleanup job when LiveKit's `emptyTimeout` fires, and (c) an
  infra dependency that W-MVP doesn't otherwise need. The moment we
  need room history, per-room settings, or persistent nicknames, this
  changes.
- **Socket.IO for state sync (host play/pause → guests).** Deferred, not
  rejected. Playback state sync is explicitly out of W-MVP scope
  (`docs/product/features/watch-together-mvp.md`, Out-of-scope list).
  When it lands, the transport is likely LiveKit's data channel
  (`canPublishData: true`) rather than a second stack — it's already
  connected, already authenticated per-room, and adds no infra.
- **Vercel Edge runtime for the token mint.** Rejected: LiveKit server
  SDK depends on Node's `crypto` module for JWT signing; the Edge
  runtime's Web-Crypto-only environment does not run the SDK
  unmodified. The mint is small and stateless anyway — no latency
  benefit from Edge that justifies rewriting JWT signing.

## Consequences

**Locks in**
- LiveKit Cloud vendor dependency for all media. Moving off would be a
  full media-stack rewrite. This is a conscious trade for shipping.
- The **room code is the capability**. Anyone with the code is a peer.
  No kick, no mute-other, no room moderation in W-MVP (explicit PM
  non-goal). If a room is compromised, the host leaves and creates a
  new one.
- **No room history.** A room that has been idle for 10 minutes is
  gone. Its code cannot be re-used to re-enter — a new room with the
  same code could in principle be created later, but only by luck
  (1 in 887M per attempt). Rejoin-after-expiry is not a feature.
- **Host-only screen share is a client-UI gate.** Server-side, every
  participant has `canPublish: true`. See the tradeoff note in the
  Token section; upgrading to server-enforced roles is a small,
  well-scoped change if it becomes necessary.
- **Nickname is never persisted or trusted.** It rides in the LiveKit
  token's `name` field and is escaped/sanitized on the display side.
  Two guests with the same nickname is fine; the LiveKit `identity`
  UUID keeps them distinct on the wire.
- **Vercel serverless (Node runtime) for the two API routes.** No Edge,
  no always-on host, no queue, no cron.

**Defers**
- Persistent rate limiting → shared store (Vercel KV / Upstash Redis)
  before public launch (same trigger as the M1/M2 debt entry).
- Sentry / structured logging → same trigger as the existing debt
  entry; W-MVP does not move it.
- Host-only publish enforced by the token → only if abuse is observed.
- Playback state sync → post-W-MVP, likely on the LiveKit data channel.
- Persistent rooms / room history → out of scope; requires a DB and a
  product reason we do not have yet.

**Open questions for downstream engineers / product**
- **LiveKit Cloud free-tier limits.** The published numbers move; last
  time we checked they included generous participant-minute allowances
  and per-project connection caps that comfortably cover ≤ 100
  concurrent rooms × ≤ 4 participants. **DevOps (W2) should confirm
  the current numbers on the LiveKit Cloud dashboard when the account
  is provisioned** and record them in `docs/architecture/tech-debt.md`
  as a monitoring trigger — if free-tier caps become a live risk we
  need to know before a session hits them, not after.
- **27 vs 31 code alphabet.** Following `CLAUDE.md` literally gives 31.
  If the product owner wants to tighten further for typing legibility,
  say so before backend implementation (W3) — it's a one-line change,
  and the security envelope is still comfortable.
- **Rate-limit thresholds.** 10 creates/IP/hour and 5 joins/(IP,code)/
  minute are seed values. If real usage shows them tripping on
  legitimate flows (e.g. a friend group whose 3 members all NAT out
  through the same IP), relax them; the brute-force math survives 3–4x
  relaxation.
