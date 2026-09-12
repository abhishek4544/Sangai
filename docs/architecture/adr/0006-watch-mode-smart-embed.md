# ADR 0006 — Watch Mode: smart-embed via provider registry

**Status:** Proposed
**Date:** 2026-09-10
**Milestone:** W-1.1 (follows W-MVP / ADR 0004; additive, ships after base MVP is live)

## Context

W-MVP shipped rooms on LiveKit with tab-share-with-audio as the shared-viewing
primitive. In practice the tab-share path is fragile: users must pick a **tab**
(not a window), tick the easy-to-miss "Share tab audio" checkbox, and even
then Firefox and Safari either don't offer tab audio or silently drop it.
DRM sites remain a black frame on the remote side (`CLAUDE.md`, W-MVP AC7)
and only one participant can share at a time. The base-MVP contract stands,
but a large fraction of the sessions the user actually runs — YouTube clips,
Twitch VODs, live sports embeds, X/Instagram video — are on sites with
first-class embed players and public playback APIs. There is a cheaper,
more reliable path for that common case.

**Watch Mode** is the v1.1 additive feature that takes it. Each participant
plays the media natively via the site's official embed player; play/pause/
seek events sync across the room over the LiveKit **data channel** already
opened by ADR 0005-phase2 (W-P2 §1). No new transport, no DB, no server-side
state. Day one ships **YouTube only** via the YouTube IFrame Player API; the
code is structured as a **provider registry** so Twitch, Vimeo, SoundCloud,
Spotify, and a generic iframe fallback slot in later without a refactor.

Two constraints frame this ADR.

1. **Screen-share is not going away.** DRM sites (Netflix / Prime / Disney+ /
   HBO Max) still render as a black frame on any embed, and there are always
   long-tail sites without a public embed. Watch Mode is the primary path
   for embed-friendly URLs; screen-share remains the documented fallback.
   Watch Mode does not replace ADR 0004's share path.
2. **The transport already exists.** W-P2 (§1) opened `canPublishData` and
   defined the versioned envelope (`{ v, type, ts, ... }`) plus the Zod-on-
   receive posture. This ADR consumes that transport rather than adding a
   new one. If it required a new signaling stack, the trade-off calculus
   changes; it does not.

Full product ACs live (or will live) in
`docs/product/features/watch-mode-mvp.md`; this ADR is the architecture.

## Decision

Adopt a **smart-embed** architecture: per-participant native playback via a
provider-specific embed component, room-wide sync via LiveKit data-channel
events, no new backend surface. Day-one provider: YouTube. Code shape:
provider registry.

The rest of this section enumerates the pieces.

### Architecture — provider registry

Every provider is one file under `src/lib/watch/providers/` exporting a
`Provider` value against a single interface:

```ts
interface Provider {
  id: string;                                  // e.g. "youtube"
  matches(url: URL): boolean;                  // host/path predicate
  extractMediaId(url: URL): string | null;     // canonical id for the URL
  Component: React.ComponentType<ProviderPlayerProps>;
}

interface ProviderPlayerProps {
  mediaId: string;
  onEvent: (e: PlayerEvent) => void;           // normalized outbound events
  controls: ProviderPlayerHandle;              // ref-forwarded, imperative
}

interface ProviderPlayerHandle {
  play(): void;
  pause(): void;
  seek(sec: number): void;
  getPosition(): number;
}

type PlayerEvent =
  | { kind: "ready" }
  | { kind: "play";  positionSec: number }
  | { kind: "pause"; positionSec: number }
  | { kind: "seek";  positionSec: number };
```

`src/lib/watch/detect-provider.ts` walks the registry in declared order and
returns the first `matches()` hit, or `null`. Registry order = precedence;
the generic-iframe fallback (when it lands) is always last.

**Day-one registry.**

- `youtube` — matches `youtube.com/watch?v=...`, `youtu.be/...`,
  `youtube.com/shorts/...`, `youtube.com/embed/...`. Component wraps the
  official **YouTube IFrame Player API** (`https://www.youtube.com/iframe_api`,
  loaded via a lazy `<script>` insertion inside the component's effect —
  never a top-level import).

That is it for W-1.1. The registry shape is what earns the "no refactor for
provider N+1" property; adding Twitch means dropping a `twitch.ts` alongside
`youtube.ts` and one line in the registry array. No caller changes.

### UI — `<WatchPanel />` in `/room/[code]`

`<WatchPanel />` is a top-level component in the room route that owns:

- **URL bar.** Text input + Load button. On submit: `new URL(...)` (rejects
  invalid input), `validateUrl()` (allowlist, see security), `detectProvider()`.
  On `null` provider: render the PM's "This site isn't supported yet — use
  screen-share for it" copy inline. On hit: publish
  `{ type: "watch/load", providerId, mediaId, controllerId }` (RELIABLE) and
  mount `Provider.Component`.
- **Provider dispatch.** Renders the matched provider's `Component` with the
  extracted `mediaId`. Nothing else knows which provider is loaded.
- **Sync hook.** `useWatchSync()` — publishes local `PlayerEvent`s and applies
  remote ones.

`<WatchPanel />` sits above `<ShareStage />` (the W-MVP tab-share surface)
in the room layout; only one of them is "primary" at a time. If a tab-share
is active and a Watch Mode URL is loaded, the ShareStage renders behind
Watch Mode with a "Screen share paused for Watch Mode" pill on the ShareStage
frame — no forcible unpublish, since ADR 0004 leaves publish rights symmetric.
UI-level precedence only.

### Sync — state shape, arbitration, drift, late-joiners

**State shape** (room-wide, one struct):

```ts
type WatchState = {
  providerId: string;
  mediaId: string;
  playbackState: "playing" | "paused";
  positionSec: number;
  updatedAt: number;      // sender's Date.now() when the event fired
  controllerId: string;   // LiveKit identity of last actor
};
```

**Arbitration.** Last-writer-wins on `updatedAt`. Client clocks are not
synchronized; a monotonic-enough drift of a few hundred ms is acceptable
because the arbitration is only used to break near-simultaneous edits. If
two events arrive within a 200 ms window the higher `updatedAt` wins;
outside that window arbitration is trivially in delivery order. This mirrors
W-P2 §2's LWW model — no consensus, no leader, no room-metadata write.

**Controller.** Whoever fired the last event is the implicit controller and
the UI displays "Playing — controlled by Sarushna". No hard lock: any
participant acting flips the label. This matches W-P2's "no host, symmetric
peers" posture and the PM's collaborative intent. If a room ever needs a
hard host (kick/mute-other-controls), that is a new ADR — same trigger as
the moderator note in W-P2 §2.

**Drift correction.** The current controller broadcasts a **heartbeat** every
**3 s** while `playbackState === "playing"`:
`{ type: "watch/heartbeat", positionSec, updatedAt, controllerId }` (LOSSY).
Non-controllers compare `remote.positionSec + age(remote.updatedAt)` to their
local `getPosition()` on receive; if `|diff| > 1.5 s`, call
`controls.seek(remote.positionSec + age)`. Heartbeat is off while paused.
Tolerance targets: play/pause round-trip ≤ 500 ms; steady-state drift < 1.5 s.

**Late-joiner handshake.** Reuses W-P2 §2's `hello`. On `RoomEvent.Connected`,
the joiner broadcasts `hello` (RELIABLE); any peer in-room > 500 ms replies
with `destinationIdentities: [joinerId]` including the current `WatchState`
alongside the P2 payload. Joiner adopts the snapshot from the earliest
`roomJoinAt` responder (tie-break: lexicographic identity), then seeks the
provider to `positionSec + age(updatedAt)` and issues `play()` or `pause()`
per `playbackState`. No response in 1.5 s → assume no Watch Mode active.
The snapshot channel already exists; Watch Mode adds fields to the reply,
not a new round-trip.

**Envelope types added to W-P2 §1.**

| Type | Kind | Fields | Notes |
|---|---|---|---|
| `watch/load` | RELIABLE | `providerId, mediaId, controllerId` | AC "load same media everywhere". |
| `watch/play` | RELIABLE | `positionSec, controllerId` | AC "play/pause across the room". |
| `watch/pause` | RELIABLE | `positionSec, controllerId` | Same. |
| `watch/seek` | RELIABLE | `positionSec, controllerId` | Explicit seek. |
| `watch/heartbeat` | LOSSY | `positionSec, controllerId` | 3-s cadence, drift correction only. |
| `watch/hello-reply` | RELIABLE | subset of `WatchState` | Extends W-P2 hello reply. |

All ride the versioned envelope from W-P2 §1. Unknown `type` or `v !== 1` →
drop silently (forward-compat). Every inbound message is Zod-parsed before
dispatch; malformed → structured log + drop, same posture as ADR 0004.

### No new backend surface

Sync is peer-to-peer over the LiveKit data channel. **No API routes, no DB,
no Redis.** This matches ADR 0004's "LiveKit is the source of truth" stance:
if the room dies, so does the Watch Mode session; nothing to clean up.

One server-side helper, symmetric to the client:

`src/lib/watch/validate-url.ts` — pure function, no I/O. Contract:

- Parses input as `new URL(...)`; non-URL throws.
- Rejects protocols other than `https:` (and `http:` in dev only, gated on
  `process.env.NODE_ENV === "development"`).
- Rejects `javascript:`, `data:`, `file:`, `blob:` explicitly (belt-and-braces
  even though the protocol allowlist above already covers them).
- Rejects hostnames matching `.local`, `localhost`, `127.0.0.0/8`,
  `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `::1`, `fc00::/7`,
  `169.254.0.0/16` (link-local / RFC1918 / loopback). Prevents accidental
  or malicious SSRF-style embeds pointing at intranet URLs.
- Returns the normalized `URL` object or throws a typed `InvalidWatchUrl`.

The helper is called **both** client-side (before publishing `watch/load`
onto the data channel) **and** server-side (if we ever expose an API surface
for URL preflight — not in W-1.1, but the function lives in `src/lib/` so
it's importable either way). No accidental client-only trust boundary.

### Security defaults

Explicit so the security-engineer review has a checklist.

- **Sandbox.** Every provider iframe carries
  `sandbox="allow-scripts allow-same-origin allow-presentation"`. `allow-scripts`
  is required — the YouTube IFrame API is JavaScript. `allow-same-origin`
  is required for the API to `postMessage` back to us. `allow-presentation`
  enables the provider's fullscreen control. **Not** granted:
  `allow-top-navigation` (embed cannot navigate the parent frame),
  `allow-forms` (embed cannot submit forms), `allow-popups`,
  `allow-modals`, `allow-pointer-lock`, `allow-downloads`. Rationale: an
  embed that turns malicious (unlikely for YouTube, possible for a future
  long-tail provider) should be unable to redirect the tab, phish, or grab
  input focus.
- **CSP `frame-src` allowlist.** Each provider's origin is added to the
  Next.js CSP explicitly (`https://www.youtube.com`, `https://www.youtube-nocookie.com`
  for the day-one set — we prefer `youtube-nocookie.com` for the same reason
  the IFrame API docs recommend it). Any other iframe origin is refused by
  the browser as defense-in-depth. Adding a provider = one CSP entry + one
  registry file. The CSP diff is part of every provider PR.
- **Data-channel payloads Zod-validated on receive.** Malformed drops
  silently, never crashes the sync loop. Same posture as W-P2 §1.
- **Publish rate limit.** Local publish capped at **≤ 10 events/sec per
  participant** across all `watch/*` types combined. Enforced client-side
  in `useWatchSync` (leaky-bucket, same shape as W-P2's reaction limiter);
  a broken or malicious client cannot flood the data channel. The 3-s
  heartbeat cadence is well inside this envelope; the limit exists to catch
  a runaway effect loop, not to shape normal traffic.
- **Nickname handling unchanged.** Controller display name comes from the
  LiveKit participant `name` field (already escaped by the tile renderer per
  W-MVP). The data-channel payload carries `controllerId` (opaque LiveKit
  identity UUID), never a nickname. Display resolution is local.
- **No secrets in the URL bar.** The URL is broadcast room-wide over the
  data channel. Users pasting a URL with a private token (rare for embed
  URLs, but possible) are effectively sharing that token with all
  participants. This is the same trust envelope as any URL a peer would
  paste into chat; called out here so the PM writes copy that doesn't
  imply the URL is private.

### Bundle discipline

`CLAUDE.md` is explicit: lazy-load the LiveKit SDK, do not ship it on the
landing page. Watch Mode inherits the same rule.

- `<WatchPanel />` and every provider `Component` are `next/dynamic` imports
  from `/room/[code]`. They must not appear in the bundle for `/`.
- The YouTube IFrame API script (`https://www.youtube.com/iframe_api`) is
  injected by the YouTube provider's `Component` effect on mount, not
  bundled. This also means the script is fetched only when a user actually
  loads a YouTube URL — not on room join.
- The provider registry file itself is fine to include in the room bundle
  (it is small — imports lazy `Component`s, not eager ones). The heavy code
  paths behind each provider are behind `React.lazy` / `next/dynamic`.

Bundle target: adding Watch Mode should not measurably grow the initial
`/room/[code]` bundle. Verified in CI via Next.js's built-in bundle output;
regression check on PR.

## Alternatives considered

- **Status quo — screen-share-only.** The path W-MVP shipped. Rejected as
  the primary Watch Mode strategy because of the failure modes catalogued
  in Context (tab-audio picker friction, Firefox/Safari gaps, DRM black
  frame, single-source). Retained as the fallback for DRM sites and
  long-tail non-embeddable URLs — Watch Mode does not replace it.
- **Hyperbeam (cloud co-browser).** Solves everything: DRM playback, real
  co-browsing (one browser, one session state, multiple viewers), audio
  parity across browsers. Rejected: metered pricing at roughly
  $0.30–0.50 per session-hour with no free tier, inconsistent with the
  free-tier-feasible constraint from ADR 0004. Parked; revisit only if we
  monetize and DRM co-viewing becomes a paid tier.
- **Neko (self-hosted co-browser).** OSS, no per-session vendor bill, but a
  full browser process per room to host, monitor, and secure. Ops burden
  and per-room CPU/RAM cost do not fit a free-tier product. Same trigger
  as Hyperbeam to reconsider.
- **Generic `<iframe src={url} />` with URL sync only.** Simple, provider-
  agnostic. Rejected as the primary path: the sites people actually want
  (YouTube, Twitch, most sports embeds) set `X-Frame-Options: SAMEORIGIN`
  or restrictive `frame-ancestors` CSPs on their canonical URLs, so a raw
  iframe of `youtube.com/watch?v=...` is refused by the browser. The
  provider registry sidesteps this by using each site's *embed* URL
  (`youtube.com/embed/...`) and *embed API*. A generic iframe fallback still
  earns its slot in the registry — last — for the small set of sites that
  are embed-friendly but don't warrant a bespoke provider.
- **Server-side URL preflight route** (`POST /api/watch/preflight`). Would
  centralize allowlist enforcement and let us record what URLs get loaded.
  Rejected for W-1.1: adds a round-trip on every load, adds a route to
  rate-limit, and validation logic runs client-side anyway to gate the
  data-channel publish. `validate-url.ts` lives in `src/lib/` so a preflight
  route is a small addition later if we ever need server-side analytics or
  a shared-store block list; nothing about the architecture forecloses it.
- **Server-authoritative playback state** (RoomService or a KV store).
  Rejected: mirrors the ADR-0004 "no DB" and W-P2 §2 "no server-side
  authority" stances. Adds a second source of truth to keep in sync with
  the LiveKit room's own lifecycle for zero product value at this scale.
- **NTP-style clock sync between clients.** Would tighten drift correction.
  Rejected as premature: the 1.5-s tolerance is comfortably inside what
  monotonic `Date.now()` drift produces over a 2-hour session on modern
  browsers, and heartbeat-based correction closes the loop every 3 s.
  Revisit if user reports show audible desync under normal conditions.

## Consequences

**Locks in**

- **Provider registry is the extension surface.** New provider = one file
  under `src/lib/watch/providers/` + one CSP `frame-src` entry + one line
  in the registry array. No refactor of `WatchPanel`, `useWatchSync`, or
  the envelope. This is the payoff for shipping YouTube-only day one.
- **LiveKit data channel carries `watch/*` events.** The envelope from
  W-P2 §1 owns Watch Mode too. Any future replacement of the signaling
  substrate (unlikely) touches every consumer of the envelope, not just
  this one.
- **LWW-with-snapshot for playback state.** Same model as W-P2 §2 for
  hold / whisper / cards. If we ever add per-participant playback
  (individual seek without desyncing others) that model doesn't help —
  new ADR.
- **Sandbox + CSP posture is the security contract.** Every provider PR
  must extend `frame-src` and set the sandbox attributes. Code review
  gate; a provider that "just needs `allow-forms`" is a red flag.
- **YouTube's origin/`enablejsapi=1`/autoplay-policy quirks are the YouTube
  provider's concern**, not the framework's. The registry interface stays
  clean; per-provider weirdness is contained.

**Forecloses**

- **True co-browsing on arbitrary logged-in sites.** Each participant is
  loading their own copy of the embed. Fine for a video (media is the
  same, presentation state syncs). Wrong tool for "shop together on my
  Amazon cart" — each viewer would see their own cart, and the site would
  refuse to embed anyway. Explicit non-goal, documented in PM copy.
- **DRM playback via Watch Mode.** Netflix / Prime / Disney+ / HBO Max
  will not appear in the provider registry. They have no publicly usable
  embed, and even if they did, DRM-protected video is unshareable through
  the browser boundary either way. Screen-share fallback with the same
  W-MVP AC7 caveat remains the only story here. This ADR does not change
  that.
- **Per-participant playback controls with room-visible state.** The
  controller-of-last-action UI is deliberately soft; a "let each person
  pause on their own copy without affecting the room" mode would require
  splitting local from broadcast state and is out of scope.

**Defers**

- **Provider expansion order** (Twitch / Vimeo / SoundCloud / Spotify /
  generic-iframe fallback). PM decides sequencing; the architecture is
  ready. Each provider is one PR against the pattern in this ADR.
- **Screen-share pre-flight helper as a stopgap before Watch Mode ships.**
  User hasn't decided; not part of this ADR. If chosen, it's a
  UI-only addition to the existing tab-share button (a modal walking the
  user through picking a tab + ticking Share tab audio); no architecture
  change.
- **Server-side URL preflight / block list.** Not needed at W-1.1 scale.
  `validate-url.ts` is already server-safe if we ever want it.
- **Sentry / structured error tracker.** Same trigger as ADR 0002–0004
  and W-P2. Watch Mode does not move it.
- **Automated bundle-size regression alert.** Manual check in PR review
  for W-1.1; automatable later.

## Open questions

- **YouTube `origin` parameter.** The IFrame API takes an `origin` param
  that some CSP configurations require. Preview URLs on Vercel have
  per-deploy origins; we need to pass `window.location.origin` at mount,
  not a hardcoded value. Called out here so the YouTube provider
  implementer doesn't miss it.
- **Autoplay policy.** Modern browsers block autoplay-with-sound without a
  user gesture. The first `watch/play` a joiner receives on a fresh page
  may need to be gated behind a one-click "Join playback" affordance for
  the joiner's own tab. PM copy call.
- **Rate-limit constant (10 events/sec/participant).** Seed value; heartbeat
  is 1/3s so we're at ~0.3 evt/sec normal, well inside. Confirm no
  legitimate flow trips it (rapid seek scrubbing on a long video may be
  the edge case) before wiring as a hard constant.
- **Fallback UX when `detectProvider()` returns `null`.** PM to write copy.
  Architecture assumes an inline "not supported yet, use screen-share for
  this URL" message with a link to the tab-share button.
