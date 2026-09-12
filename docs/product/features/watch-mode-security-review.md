# Watch Mode v1.1 — Security Review (plan stage)

**Reviewer:** Application Security
**Date:** 2026-09-10
**Milestone:** W-1.1 (pre-implementation plan review)
**Docs under review:**
- `docs/product/features/watch-mode-mvp.md`
- `docs/architecture/adr/0006-watch-mode-smart-embed.md`
- `docs/product/features/watch-mode-backend-tasks.md`
- `docs/product/features/watch-mode-frontend-tasks.md`
**Foundation docs consulted:** ADR 0004, ADR 0005, `CLAUDE.md`, `next.config.ts`, `src/lib/livekit/token.ts`, `src/lib/room/envelope.ts`.

---

## 1. Summary

Overall verdict: **Yellow — proceed with plan changes.** The architecture is
defensible: peer-to-peer sync over an already-authenticated LiveKit data
channel, Zod-on-receive, sandboxed iframe, no new backend surface. Nothing in
the plan is structurally unsound. But several items in the ADR's "Security
defaults" section under-specify what needs to be true at implementation time,
and one pre-req (CSP bootstrap) is being introduced with `'unsafe-inline'` on
`script-src` — an existing gap being papered over on the way to Watch Mode
rather than closed by it.

Findings by severity: **0 Critical, 2 High, 5 Medium, 4 Low, 3 Info.**

Top three concerns:
1. **CSP `script-src 'unsafe-inline'` is being introduced as a shipping
   posture, not a tracked-deferral.** (H1) The backend spec ships CSP with
   `'unsafe-inline'` in the same PR as Watch Mode's `frame-src` addition; the
   nonce migration is an "open question." That inverts the intended defense.
2. **`updatedAt` is sender-controlled and used as the sole arbitration
   key.** (H2) A peer can stamp `Number.MAX_SAFE_INTEGER` and pin themselves
   as permanent controller / freeze `WatchState` against every subsequent
   legitimate event. Not covered in the ADR's Zod schema or the reducer spec.
3. **Sandboxed iframe with `allow-scripts allow-same-origin` on a
   third-party origin is a well-known combination that effectively removes
   the sandbox for that origin.** (M1) Documented posture is defensible for
   YouTube specifically; must be re-argued for every future provider or the
   registry silently degrades safety.

---

## 2. Findings

### H1 — CSP bootstrap ships `'unsafe-inline'` on `script-src` as a shipping value, not a deferral

**Severity:** High
**Affected:** `docs/product/features/watch-mode-backend-tasks.md` §W-1.1-B4;
Open question #1 in the same file.

**Description.** The backend spec introduces CSP as a Watch Mode pre-req and
proposes:

```
script-src 'self' 'unsafe-inline' https://www.youtube.com;
```

with a comment that the nonce migration is tracked as tech debt. This is the
first CSP the app will ship. Setting `'unsafe-inline'` on the very first CSP
neutralises the primary XSS mitigation CSP exists to provide, on the exact
route that (a) accepts user-controlled text (URL bar, nicknames, chat), (b)
loads third-party scripts (YouTube IFrame API), and (c) executes inside a
context that holds a LiveKit capability token in sessionStorage. The
`https://www.youtube.com` `script-src` entry is also broader than needed —
only `iframe_api` is loaded, but `script-src` cannot scope by path.

Open question #1 (same file) flags this but leaves the resolution to
"before v1.1 ships to production" — which is the wrong side of the review
gate. The nonce strategy needs to be decided **before** the CSP PR merges,
because retrofitting a nonce after `'unsafe-inline'` is live means every
inline runtime script added between now and then becomes a migration item.

**Recommended remediation.**
- Decide the nonce strategy now (Next.js middleware nonce, or `next/script`
  strategy=beforeInteractive with a build-time hash for Next's known inline
  runtime chunk). Do not merge W-1.1-B4 with `'unsafe-inline'` unless the
  same PR includes the tech-debt ticket ID and an owner-assigned trigger
  date.
- Consider gating `script-src https://www.youtube.com` behind a route-scoped
  header (only `/room/[code]` needs it) — see M4.
- Confirm `strict-dynamic` viability. If viable, `strict-dynamic` + nonce
  is the modern posture and lets us drop the explicit YouTube origin from
  `script-src` (the nonced loader inherits trust to `iframe_api`).

---

### H2 — `WatchState.updatedAt` is peer-controlled and unbounded; used as the sole LWW arbiter

**Severity:** High
**Affected:** ADR 0006 §"Sync — state shape, arbitration, drift, late-joiners";
backend tasks §W-1.1-B3 (schema for `hello/snapshot.watchState.updatedAt` is
`z.number().int().nonnegative()` — no upper bound); frontend tasks §W-1.1-F5
LWW reducer.

**Description.** ADR 0006 defines arbitration as "last-writer-wins on
`updatedAt`" where `updatedAt` is "sender's `Date.now()` when the event
fired." The Zod schema accepts any non-negative integer. Any peer already in
the room (i.e. holding a valid token, which is exactly the trust boundary
the room-code capability model already grants) can:

1. Publish a `watch/heartbeat` with `updatedAt: Number.MAX_SAFE_INTEGER` —
   from that point on, every legitimate event with a real `Date.now()` is
   older and gets dropped by the LWW reducer. The room is now stuck on
   whatever `positionSec` / `playbackState` the malicious peer chose,
   permanently, for the life of the room.
2. Do the same with `watch/load`, pinning the room to a specific `mediaId`
   and denying subsequent `watch/load` from any peer.
3. Do the same with a snapshot reply (`hello.snapshot.watchState.updatedAt`),
   poisoning every late joiner's initial state.

This is a griefing vector, not RCE — the room-code capability model already
lets any joined peer play/pause anyone else's playback. But the LWW model
turns "annoy for 1 second" into "brick the room until the code expires,"
which is a real UX degradation not currently called out in the plan.

**Recommended remediation.**
- Cap `updatedAt` on receive: `if (event.updatedAt > Date.now() + SKEW_MS)
  drop` with `SKEW_MS = 5 * 60 * 1000` (5 min tolerance for clock skew).
  Apply in `decodeEvent` or the LWW reducer.
- Alternative (weaker): tie-break equal `updatedAt` values by receipt order
  and cap the delta on any single accepted event to some sane wall-clock
  bound.
- Update the ADR §"Arbitration" paragraph to specify the skew cap
  explicitly. Add a schema-level `max()` on `updatedAt` in the Zod schema
  set to a value well below `Number.MAX_SAFE_INTEGER` (e.g. year 2100 in
  unix-ms — `4102444800000`).
- Add a unit test in W-1.1-F5 (`use-watch-sync.test.ts`) that an inbound
  event with `updatedAt = Date.now() + 10 minutes` is dropped.

---

### M1 — `sandbox="allow-scripts allow-same-origin"` on a third-party iframe is effectively no sandbox for that origin

**Severity:** Medium
**Affected:** ADR 0006 §"Security defaults" first bullet; frontend tasks
§W-1.1-F3.

**Description.** The sandbox posture chosen (`allow-scripts allow-same-origin
allow-presentation`) is the correct minimum for the YouTube IFrame API to
`postMessage` back to us. However, the combination `allow-scripts +
allow-same-origin` when the iframe is loaded from a *third-party origin* is
generally considered by CSP guidance to be equivalent to no sandbox from
that origin's perspective — the embed can execute arbitrary JS in its own
origin, which in YouTube's case includes reading YouTube cookies, running
arbitrary DOM manipulation inside its own frame, and calling
`window.parent.postMessage` freely.

The residual risk is bounded by (a) the parent frame's origin isolation —
YouTube JS cannot read our DOM or storage across origins, (b) the fact
that we `postMessage` in and out and do not `eval` YouTube-sent data, and
(c) the fact that we sandbox out `allow-top-navigation`, `allow-forms`,
`allow-popups`, `allow-modals`, `allow-downloads`, which meaningfully limit
what a compromised embed could do to *us*.

The ADR's rationale is correct for YouTube today; the risk is that the same
sandbox is treated as a template for future providers where the origin is
less trustworthy (a hypothetical generic-iframe fallback especially).

**Recommended remediation.**
- Amend ADR 0006 §"Security defaults" to explicitly state: "This sandbox
  posture is auditable per-provider. A provider PR that adds a less-trusted
  origin must justify or tighten these flags." Currently the ADR presents
  the sandbox as universal.
- For the future generic-iframe fallback, pre-commit to *dropping*
  `allow-same-origin` unless the embed's `postMessage` model requires it.
- Also add a per-frame `allow` attribute (Feature Policy) to explicitly deny
  `camera; microphone; geolocation; payment; usb` on the iframe. The
  top-level `Permissions-Policy` header restricts to `self`, but iframes
  inherit only if you set `allow=""` — belt-and-braces.

---

### M2 — URL validator's SSRF-adjacent host blocklist is DNS-time-of-use safe by luck, not by design

**Severity:** Medium
**Affected:** ADR 0006 §"No new backend surface" bullet on host rejection;
backend tasks §W-1.1-B2 rules 5 and 6; frontend tasks §W-1.1-F1.

**Description.** The validator is described as pure (no I/O) and rejects
hostnames matching RFC1918 / loopback / link-local *literal* strings and
IPv4/IPv6 CIDRs. This is correct for the immediate concern — a user pasting
`http://10.0.0.1` — but only accidentally correct against the general SSRF
family, because:

- The validator runs client-side before publish and (spec permitting)
  server-side if a preflight route is ever added.
- The URL is not dereferenced server-side in v1.1 — the iframe fetches it
  in each participant's browser. Browsers do their own DNS resolution and
  will happily connect to a public hostname that resolves to a private
  IP (DNS rebinding, or simply an attacker-controlled public DNS name that
  A-records to `10.0.0.1`).
- The `provider.matches()` allowlist for YouTube pins the *hostname* to a
  fixed set (`www.youtube.com`, `youtu.be`, etc.) which mitigates this for
  v1.1. The moment a generic-iframe fallback provider lands, this
  mitigation evaporates.
- Punycode / IDN homograph URLs are not addressed. `xn--youtube-...` or
  Unicode-lookalike domains would pass a naive string blocklist and fail
  the YouTube `matches()` today, but there's no explicit rejection of
  non-ASCII hostnames.

For v1.1 (YouTube-only, hostname-allowlisted), the risk is close to zero.
The plan should call this out so the generic-iframe fallback doesn't
inherit an SSRF assumption the current design does not actually enforce.

**Recommended remediation.**
- Add to ADR 0006 §"No new backend surface": "The host blocklist in
  `validate-url.ts` is a *literal-string* defense. Any provider added to the
  registry that does not itself hostname-allowlist (i.e. the generic-iframe
  fallback) must be gated behind an explicit ADR extension that addresses
  DNS-resolution-time SSRF."
- Amend W-1.1-B2 rule 5 to also reject non-ASCII hostnames unless
  normalized with `URL`'s built-in punycode handling and re-checked against
  the blocklist post-normalization. `new URL("https://über.example")`
  already normalizes to punycode via `url.hostname`; confirm the validator
  reads `url.hostname` (already punycoded), not the raw input.
- Add a test case: `validateWatchUrl("https://xn--10-0-0-1.example")`
  behavior is documented (currently unspecified).

---

### M3 — `controllerId` is sender-supplied on the wire and can be spoofed

**Severity:** Medium
**Affected:** ADR 0006 envelope table (all six new types carry
`controllerId` as a string payload field); frontend tasks §W-1.1-F5 LWW
reducer; ADR 0006 §"Controller".

**Description.** The envelope carries `controllerId: string(1..128)` in
every `watch/*` event. The frontend spec sets it to "the local participant
identity as `controllerId`" but nothing forces this at the receiving end:
a malicious peer can send `watch/play` with `controllerId: "<some other
peer's UUID>"`, and the receiving client will render "Playing — controlled
by Sarushna" even though Sarushna did not touch anything.

Mitigation exists at the transport layer: LiveKit's `DataReceived` callback
provides the *actual* sending participant's identity as an out-of-band
argument (`participant.identity`). ADR 0005 §"Chat message" already relies
on this pattern ("identity comes via the `DataReceived` participant arg").
Watch Mode should adopt the same rule: `controllerId` in the payload is
advisory / discarded; the real controller is the LiveKit-provided identity
of the sender.

Impact: cosmetic-plus. An attacker can misattribute controller actions in
the UI ("Sarushna paused" when actually the attacker did). Not a permission
escalation — everyone can pause anyway. But it's a trust-boundary
regression compared to how Phase 2 events are handled today.

**Recommended remediation.**
- Amend ADR 0006 §"Controller": "`controllerId` in the payload is
  informational; the authoritative controller is the LiveKit
  `DataReceived` participant identity. Diverging values are logged and the
  transport identity wins."
- Drop `controllerId` from the payload entirely (breaks nothing — the
  receiver already has it from LiveKit) or keep it and add a receiver-side
  check that mismatches log-and-still-apply. Cleanest is: drop from the
  payload, derive from transport at the receiver, populate at render time.
- Backend spec W-1.1-B3 schema should be updated if `controllerId` is
  dropped from the envelope, or a comment added if it is kept as
  informational-only.

---

### M4 — CSP is applied globally instead of route-scoped; broader `script-src` than needed

**Severity:** Medium
**Affected:** `next.config.ts` (existing `headers()` returns one entry with
`source: "/:path*"`); backend tasks §W-1.1-B4.

**Description.** The backend spec proposes a single global CSP header. The
Watch Mode dependencies (`https://www.youtube.com` in `script-src`,
`youtube.com` + `youtube-nocookie.com` in `frame-src`) are only needed on
`/room/[code]`. The landing page (`/`) doesn't need YouTube in `frame-src`
or `script-src` at all, and it's the higher-value target: it's where users
paste room codes and where a phishing embed would do the most damage.

Next.js supports per-route header rules by adding multiple entries to the
`headers()` async return. Adding a stricter CSP on `/` costs one entry.

**Recommended remediation.**
- Split into two CSPs in `next.config.ts`:
  - `/` and everything not `/room/*`: no YouTube in any directive;
    `frame-src 'none'`; `script-src 'self'` + whatever the runtime needs.
  - `/room/:code*`: adds YouTube to `frame-src` and `script-src`, adds
    `wss://*.livekit.cloud` to `connect-src`.
- Update W-1.1-B4 acceptance criteria to include curl checks against both
  routes with divergent expected headers.

---

### M5 — URL is broadcast unmodified to all peers; no consent gesture per new URL

**Severity:** Medium
**Affected:** ADR 0006 §"Security defaults" last bullet ("No secrets in the
URL bar"); PM doc §"User stories" US2 and AC1; frontend tasks §W-1.1-F6.

**Description.** Any participant can publish `watch/load` with an arbitrary
YouTube URL. Every peer's browser will immediately load that URL in the
YouTube IFrame Player. That fetches from `youtube-nocookie.com`, sends
`Referer` to Google, and (if the joiner has clicked once on the page — the
"autoplay-blocked" flow explicitly gates on a prior gesture) starts
playing audio.

Two concerns:
1. **Cross-participant abuse.** A peer who dislikes the room can spam
   `watch/load` with jump-scare or shock content and every other peer's
   browser plays it. The room-code capability model already allows this
   for anyone in the room; the PM doc doesn't disclose it as a design
   consequence.
2. **URL contains embedded start-time / query params** that autoplay. The
   validator does not strip query parameters other than `v`. `?t=` (start
   time) is fine; `?autoplay=1` from a paste — the YouTube provider
   controls autoplay at the embed URL level (`enablejsapi=1&origin=...`),
   so a user-pasted `?autoplay=1` in the source URL is stripped by
   `extractMediaId`. Confirm this is actually the case in the extractor
   design.

**Recommended remediation.**
- Amend ADR 0006 §"Security defaults": add a bullet "Any participant can
  cause every other participant's browser to load a URL. The trust model
  is 'anyone in the room is trusted' — same as the base MVP. This
  extends to embedded media autoplay."
- Add UI-level friction: when a `watch/load` arrives from a peer who is
  not the local user, and the local user's page has never had a click,
  show a "Peer wants to start [title/host] — [Join] [Ignore]" affordance
  instead of auto-loading the iframe. This dovetails with the
  autoplay-blocked flow already in W-1.1-F5. Optional for v1.1; call the
  choice out.
- Confirm `extractMediaId` strips query params (the spec implies it —
  "normalization is in `extractMediaId`" — but the extractor's contract is
  not written).

---

### M6 — Nickname → "Controlled by X" pill: XSS surface if the pill escape path is not the same as tile renderer

**Severity:** Medium (Low if verified)
**Affected:** ADR 0006 §"Security defaults" "Nickname handling unchanged"
bullet; frontend tasks §W-1.1-F6 "Controlled by X pill".

**Description.** The plan is correct in principle: the payload carries
`controllerId` (opaque UUID), display resolution is local, name comes from
LiveKit's participant `name` field, which is "already escaped by the tile
renderer per W-MVP." This depends entirely on the pill using React's
default text interpolation (which is safe) versus something like
`dangerouslySetInnerHTML` or a formatted string passed to a component that
renders as HTML. React's default is safe; the risk is a future refactor
that swaps in a markdown renderer or similar.

**Recommended remediation.**
- Frontend spec W-1.1-F6 should add an explicit acceptance criterion:
  "Controller display name is rendered via React text interpolation only
  — no `dangerouslySetInnerHTML`, no HTML rendering library, no template
  substitution into an existing HTML string." Same rule applies to the
  screen-reader `aria-label` template.
- Add a test: a participant with `name = "<img src=x onerror=alert(1)>"`
  renders as literal text in the pill.

---

### L1 — Rate limit is client-only and the abuse ceiling is not quantified

**Severity:** Low
**Affected:** ADR 0006 §"Security defaults" "Publish rate limit" bullet;
backend tasks §W-1.1-B5.

**Description.** ADR 0006 caps local publishes at 10 events/sec/participant
via a leaky bucket in `useWatchSync`. It correctly acknowledges this is
"local publish cap; a malicious client can bypass it." The abuse ceiling
is bounded by (a) the room-code capability model (only peers already in
the room can publish), (b) LiveKit's per-connection publish rate limits at
the SFU layer (which are not documented in the plan but exist on LiveKit
Cloud), and (c) the room maximum of 4 participants.

At 4 peers × unlimited publishes each × RELIABLE delivery, a flood would
degrade the room-wide sync loop for all peers. Recovery is: leave the
room, join a new one. Acceptable for MVP; call out the ceiling explicitly
so the moment a per-room participant cap grows past 4, this is revisited.

**Recommended remediation.**
- Add to ADR 0006 §"Security defaults" or the "Consequences → Locks in"
  block: "Client-side rate limit only. Abuse blast radius is bounded by
  the 4-participant room cap. If room-max grows, re-evaluate server-side
  data-channel rate limiting or the LiveKit RoomService kick fallback
  (W-1.1-B5)."

---

### L2 — Zod schemas for `watch/*` do not bound `positionSec`

**Severity:** Low
**Affected:** Backend tasks §W-1.1-B3 schema definitions (all use
`z.number().nonnegative()` for `positionSec`).

**Description.** `positionSec` is unbounded on the high side. A peer can
send `positionSec: 1e18`, which the receiver will pass to
`player.seekTo(1e18, true)`. YouTube's player will clamp to the video
length in practice, so the impact is small — the receiver seeks past the
end, the video ends. But an unbounded number field is a smell, and if a
future provider does not clamp (a raw `<video>` element with a
misconfigured source, for instance), NaN/Infinity handling gets
implementation-defined.

**Recommended remediation.**
- Cap `positionSec` at `z.number().nonnegative().max(24 * 60 * 60)` (24
  hours). YouTube videos longer than that don't exist; live streams use
  head-of-stream, not a numeric position.
- Same for `updatedAt` in `hello/snapshot.watchState` (already covered by
  H2's remediation).

---

### L3 — SRI on the YouTube IFrame API is impossible; note in tech-debt

**Severity:** Low
**Affected:** ADR 0006 §"Bundle discipline" YouTube script injection.

**Description.** The IFrame API loader (`https://www.youtube.com/iframe_api`)
is a bootstrap that loads a second script from Google. Even the bootstrap
itself changes without a versioned URL, so `<script integrity="...">` is
not viable. This is inherent to the vendor, not a fix we own.

**Recommended remediation.**
- Add to ADR 0006 §"Consequences → Locks in": "The YouTube IFrame API is
  loaded from `www.youtube.com` without SRI. Compromise of Google's CDN
  is out of scope; documented as a known un-mitigable third-party trust
  dependency."
- No code change. Info-plus.

---

### L4 — `youtube-nocookie.com` is called out in ADR §"Security defaults" but the frontend spec fixes the embed URL to it and the CSP spec allowlists both

**Severity:** Low
**Affected:** Backend tasks §W-1.1-B4 CSP (`frame-src` includes both);
frontend tasks §W-1.1-F3 (embed URL is `youtube-nocookie.com`).

**Description.** The plan uses `youtube-nocookie.com` for the embed
(privacy-preferred, per ADR) and also allowlists `www.youtube.com` in
`frame-src` and `script-src`. `www.youtube.com` is only needed for the
IFrame API bootstrap (loaded via `<script>`) and potentially for cross-
domain `postMessage` routing during embed handshake. Whether `frame-src
www.youtube.com` is actually needed at runtime depends on whether the
IFrame API creates an internal nested frame from `www.youtube.com` during
init. Empirically it can.

**Recommended remediation.**
- At implementation time, drop `www.youtube.com` from `frame-src` and see
  if the player still initializes without a CSP violation. If yes, drop
  it. If no, leave the note in W-1.1-B4 explaining why.
- Not a blocker for merge.

---

### I1 — Third-party privacy disclosure is missing from the PM copy

**Severity:** Info
**Affected:** PM doc §"In scope" (mentions DRM copy but not YouTube data
sharing); ADR 0006 §"Security defaults" (mentions `youtube-nocookie.com`
but not the user-facing disclosure).

**Description.** When Watch Mode starts, every participant's browser
contacts Google. `youtube-nocookie.com` avoids the tracking cookie but
still sends `Referer`, IP, and viewing telemetry. The PM copy for the URL
input mentions DRM (AC8) but not privacy. Some users assume "no accounts"
extends to "no third-party data collection." It doesn't.

**Recommended remediation.**
- Add a one-liner near the DRM notice: "Playing a YouTube video sends your
  IP and viewing data to Google." Language is PM's call; the presence of
  a disclosure is not.

---

### I2 — Log hygiene: URLs and mediaIds are public and safe to log, call this out

**Severity:** Info
**Affected:** Backend tasks §W-1.1-B4 CSP violation-report handling (not
specified); envelope drop log path.

**Description.** The plan says structured logs. Watch Mode adds two data
classes that could show up in logs: pasted URLs and extracted mediaIds.
Both are public identifiers by construction (they're URLs a user pasted
intending to broadcast to the room). Not PII, not secrets. Logging them
is fine and useful for abuse diagnosis. Called out for explicitness —
CLAUDE.md's "No PII or secrets in logs" is the default; this feature does
not tempt anything into that category.

**Recommended remediation.**
- Add to the envelope drop log path: include the drop `reason` code
  (already spec'd) and the participant identity (already available). Do
  not include full raw payloads (a malformed payload could contain
  attacker-controlled arbitrary bytes).

---

### I3 — Room-code capability model is not regressed by Watch Mode

**Severity:** Info
**Affected:** ADR 0006 (no explicit statement); ADR 0004 §"Consequences";
ADR 0005 §8.

**Description.** Verified: `canPublishData: true` was flipped in ADR 0005
§8 and is present in `src/lib/livekit/token.ts` today. LiveKit rooms are
isolated per-room by token scope (`room: <code>` in the grant). A peer
holding a token for room A cannot publish data-channel events to room B.
Watch Mode adds no new grant, no new API route, no cross-room state. The
`canPublishData: true` grant was already the trust envelope Phase 2 shipped;
Watch Mode consumes it without widening.

**Recommended remediation.**
- None. Called out so the reviewer's sign-off is on record.

---

## 3. Required changes before implementation

The following must be resolved in the plan (ADR / PM doc / task specs)
**before code is written**. Everything else can be handled during
implementation review.

1. **H1** — Decide the CSP nonce strategy. Do not ship `'unsafe-inline'`
   without a signed-off tech-debt ticket and owner.
2. **H2** — Amend ADR 0006 to cap `updatedAt` on receive; add the schema
   `max()` in W-1.1-B3; add the unit-test case in W-1.1-F5.
3. **M1** — Amend ADR 0006 §"Security defaults" to make the sandbox posture
   per-provider-auditable, not universal. Pre-commit to dropping
   `allow-same-origin` for the future generic-iframe fallback.
4. **M3** — Amend ADR 0006 §"Controller" to declare payload
   `controllerId` informational; authoritative controller is the
   LiveKit `DataReceived` sender identity. Either drop the field from the
   envelope schema (backend spec W-1.1-B3) or keep with a receiver-side
   reconcile rule.
5. **M4** — Update `next.config.ts` header plan to be route-scoped: `/`
   gets a stricter CSP than `/room/:code*`. Amend W-1.1-B4 acceptance
   criteria accordingly.
6. **M5** — Amend ADR 0006 §"Security defaults" to state explicitly:
   "Any participant can cause every other participant's browser to load a
   URL." Confirm `extractMediaId` strips source-URL query params (write
   the extractor contract in W-1.1-F3).

Items M2, M6, L1–L4, I1–I3 can be captured in the implementation-review
checklist and addressed during PR review; they do not require plan edits
before code starts.

---

## 4. Open questions for the tech-lead

1. **Is Next.js middleware-based CSP nonce viable in the current App
   Router setup?** If yes, H1's remediation is a one-file change to a new
   `middleware.ts`. If no (SSG interactions, etc.), the interim
   `'unsafe-inline'` posture needs an owner and a trigger.
2. **Does LiveKit's SFU enforce a per-connection data-channel publish
   rate at the free tier?** Backend spec W-1.1-B5 assumes not (says "the
   SFU forwards data-channel payloads without server-side inspection at
   our tier"). Confirm. If it does enforce, L1's ceiling is tighter and
   H2's griefing vector is proportionally throttled.
3. **YouTube IFrame API behavior when `origin` param does not match the
   parent frame's actual origin.** ADR 0006 open-questions flags Vercel
   preview URLs. Frontend spec W-1.1-F3 uses `window.location.origin` at
   mount. Confirm this is stable across the page's lifetime (no post-load
   URL rewrites via `history.pushState` that would leave the param
   stale).
4. **Does the plan for `hello.snapshot.watchState` include a
   receiver-side sanity check on `providerId` against the local registry?**
   If a peer sends `providerId: "malicious-provider"` in a snapshot reply
   and the joiner does not validate against `PROVIDERS`, the joiner
   dispatches to a component that does not exist. Backend spec W-1.1-B3
   accepts any string 1–64 chars. Confirm the receiver drops unknown
   `providerId`s.
5. **Is a per-room maximum of 4 participants still the target for W-1.1?**
   ADR 0004 assumes so. If room-max grows, L1 and H2 both re-open.
