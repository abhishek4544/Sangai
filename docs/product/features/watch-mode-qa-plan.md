# Watch Mode v1.1 — QA Test Plan

**Status:** Ready for execution after W5 (base MVP) review passes
**Milestone:** W-1.1
**Test runner — unit/integration:** Vitest (`npm test` / `npx vitest run`)
**Test runner — e2e:** Playwright (not yet installed; add `@playwright/test` before W-1.1 QA begins — see setup note below)
**Source of truth for ACs:** `docs/product/features/watch-mode-mvp.md`
**Architecture reference:** `docs/architecture/adr/0006-watch-mode-smart-embed.md`

> **Playwright setup note.** The repo currently has no `@playwright/test` dependency and no
> `playwright.config.ts`. Before executing E2E tests, add the package and a config that points
> `baseURL` at the local dev server (`http://localhost:3000`). The two-browser tests require
> two `BrowserContext` objects within a single test process; use Playwright's
> `browser.newContext()` pattern, not two separate workers. Add `test:e2e` to `package.json`
> scripts pointing at `playwright test`.

---

## 1. Unit tests

Run with: `npx vitest run src/lib/watch/`

New test files live alongside the modules they cover per the existing repo convention
(`foo.ts` + `foo.test.ts`). All unit tests run in the `node` environment (matching
`vitest.config.ts`); no DOM, no browser API calls.

### U1 — `validate-url.ts`: accepted YouTube shapes return `ok: true` with correct `mediaId`

**Preconditions:** `src/lib/watch/validate-url.ts` implemented per W-1.1-B2/F1.
**Test file:** `src/lib/watch/validate-url.test.ts`

For each URL shape below, call `validateWatchUrl(url)` and assert the result:

| # | Input URL | Expected `providerId` | Expected `mediaId` |
|---|---|---|---|
| U1a | `https://www.youtube.com/watch?v=dQw4w9WgXcQ` | `youtube` | `dQw4w9WgXcQ` |
| U1b | `https://youtube.com/watch?v=dQw4w9WgXcQ` | `youtube` | `dQw4w9WgXcQ` |
| U1c | `https://youtu.be/dQw4w9WgXcQ` | `youtube` | `dQw4w9WgXcQ` |
| U1d | `https://www.youtube.com/shorts/dQw4w9WgXcQ` | `youtube` | `dQw4w9WgXcQ` |
| U1e | `https://www.youtube.com/embed/dQw4w9WgXcQ` | `youtube` | `dQw4w9WgXcQ` |
| U1f | `https://m.youtube.com/watch?v=dQw4w9WgXcQ` | `youtube` | `dQw4w9WgXcQ` |
| U1g | `https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ` | `youtube` | `dQw4w9WgXcQ` |

**Pass criteria:** All seven return `{ ok: true, providerId: "youtube", mediaId: "dQw4w9WgXcQ" }`.
The `mediaId` is identical across all accepted shapes — normalization lives in `extractMediaId`.

---

### U2 — `validate-url.ts`: dangerous and private URLs are rejected

**Test file:** `src/lib/watch/validate-url.test.ts`

For each input call `validateWatchUrl(input)` and assert `ok === false` with the exact `reason`:

| # | Input | Expected `reason` |
|---|---|---|
| U2a | `javascript:alert(1)` | `protocol_not_https` |
| U2b | `data:text/html,<script>alert(1)</script>` | `protocol_not_https` |
| U2c | `file:///etc/passwd` | `protocol_not_https` |
| U2d | `blob:https://example.com/abc` | `protocol_not_https` |
| U2e | `http://localhost/evil` | `blocked_host` |
| U2f | `https://localhost/evil` | `blocked_host` |
| U2g | `https://127.0.0.1/internal` | `blocked_host` |
| U2h | `https://10.0.0.1/private` | `blocked_host` |
| U2i | `https://172.16.0.1/private` | `blocked_host` |
| U2j | `https://192.168.1.1/secret` | `blocked_host` |
| U2k | `https://169.254.0.1/link-local` | `blocked_host` |
| U2l | `https://[::1]/loopback` | `blocked_host` |
| U2m | `https://[fc00::1]/ula` | `blocked_host` |
| U2n | `https://[fe80::1]/link-local` | `blocked_host` |
| U2o | `https://myserver.local/resource` | `blocked_host` |
| U2p | `not a url at all` | `invalid_url` |
| U2q | `https://` | `invalid_url` |
| U2r | `${"x".repeat(2049)}` | `too_long` |
| U2s | `http://www.youtube.com/watch?v=abc` (production) | `protocol_not_https` |

**Pass criteria:** All return `{ ok: false, reason: <expected> }`. No input throws an
unhandled exception — the function must return, never throw, on invalid input.

---

### U3 — `validate-url.ts`: `http:` bypass gate in development mode only

**Preconditions:** Test framework must be able to set `process.env.NODE_ENV = "development"`.
**Test file:** `src/lib/watch/validate-url.test.ts`

- **U3a:** With `NODE_ENV = "development"`, `validateWatchUrl("http://www.youtube.com/watch?v=abc123")` returns `{ ok: true }`.
- **U3b:** With `NODE_ENV = "production"`, the same URL returns `{ ok: false, reason: "protocol_not_https" }`.

**Pass criteria:** The gate is environment-conditional, not absent.

---

### U4 — `validate-url.ts`: unsupported-but-valid host returns `unsupported_provider`

**Test file:** `src/lib/watch/validate-url.test.ts`

| # | Input | Expected `reason` |
|---|---|---|
| U4a | `https://www.netflix.com/watch/12345` | `unsupported_provider` |
| U4b | `https://www.wikipedia.org/wiki/Film` | `unsupported_provider` |
| U4c | `https://www.twitch.tv/videos/123456` | `unsupported_provider` |

**Pass criteria:** Function reaches step 6 (provider match) without being caught by the
protocol or host blocklist, then correctly returns `unsupported_provider`.

---

### U5 — Provider registry: `detectProvider` routing

**Preconditions:** `src/lib/watch/providers/index.ts` implemented per W-1.1-F2.
**Test file:** `src/lib/watch/providers/index.test.ts`

- **U5a:** `detectProvider("https://www.youtube.com/watch?v=abc")` returns a non-null result with `provider.id === "youtube"` and `mediaId === "abc"`.
- **U5b:** `detectProvider("https://www.wikipedia.org/wiki/Film")` returns `null` (no provider matches; day-one registry has no generic-iframe fallback).
- **U5c:** `detectProvider("not a url")` returns `null` without throwing.
- **U5d:** `detectProvider("https://192.168.1.1/bad")` returns `null` without throwing (validate-url rejects it before provider walk).
- **U5e:** Registry iterates in declared order — given a synthetic second registry entry whose `matches()` always returns `true` inserted at index 1, a YouTube URL still resolves to `youtube` (index 0), not the synthetic entry.

**Pass criteria:** All five assertions hold. U5e guards the "registry order = precedence" invariant.

---

### U6 — YouTube provider: `matches` and `extractMediaId`

**Preconditions:** `src/lib/watch/providers/youtube.ts` implemented per W-1.1-F3.
**Test file:** `src/lib/watch/providers/youtube.test.ts`

- **U6a–g:** `matches` returns `true` for all seven URL shapes from U1a–g.
- **U6h:** `matches` returns `false` for `https://vimeo.com/123456`.
- **U6i:** `matches` returns `false` for `https://www.twitch.tv/videos/123456`.
- **U6j:** `extractMediaId(new URL("https://youtu.be/dQw4w9WgXcQ"))` returns `"dQw4w9WgXcQ"`.
- **U6k:** `extractMediaId(new URL("https://www.youtube.com/shorts/dQw4w9WgXcQ"))` returns `"dQw4w9WgXcQ"`.
- **U6l:** `extractMediaId(new URL("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s"))` returns `"dQw4w9WgXcQ"` (extra query params ignored).
- **U6m:** `extractMediaId(new URL("https://www.youtube.com/watch"))` (no `v` param) returns `null`.

**Pass criteria:** All assertions hold. Pure functions, no browser mock needed.

---

### U7 — Envelope schemas: round-trip parse for each `watch/*` type

**Preconditions:** `src/lib/room/envelope.ts` extended per W-1.1-B3/F4.
**Test file:** `src/lib/room/envelope.test.ts` (extend existing file)

For each type, encode a valid payload and assert `decodeEvent(encoded)` returns the original
(not `null`). Types to cover: `watch/load`, `watch/play`, `watch/pause`, `watch/seek`,
`watch/heartbeat`, `watch/stop`.

- **U7a–f:** Round-trip for each of the six types passes with a well-formed payload.
- **U7g:** `watch/heartbeat` with `positionSec: -1` (negative) returns `null` from `decodeEvent`.
- **U7h:** `watch/play` with `positionSec: "sixty"` (wrong type) returns `null`.
- **U7i:** A payload with `type: "watch/unknown-future-type"` and `v: 1` returns `null` (unknown type drops silently — forward-compat).
- **U7j:** `hello/snapshot` with `watchState: null` parses without error.
- **U7k:** `hello/snapshot` with a fully-populated `WatchState` object parses without error.
- **U7l:** `hello/snapshot` without a `watchState` key at all (field absent) parses without error (`optional()` guard).

**Pass criteria:** U7a–f return non-null; U7g–i return `null`; U7j–l parse without throwing.
The sync loop's "malformed → drop" posture requires U7g–i to return `null`, never throw.

---

### U8 — `useWatchSync` reducer: LWW arbitration

**Preconditions:** `src/lib/watch/use-watch-sync.ts` implemented per W-1.1-F5.
**Test file:** `src/lib/watch/use-watch-sync.test.ts`
**Setup:** Extract the pure LWW reducer from the hook and test it in isolation. Mock `useRoomChannel`.

- **U8a:** Applying a `watch/play` event with `updatedAt = T+100` after a `watch/pause` with `updatedAt = T` leaves state as `playing`.
- **U8b:** Applying a `watch/pause` event with `updatedAt = T-1` (older) after a `watch/play` with `updatedAt = T` leaves state as `playing` (stale event is dropped).
- **U8c:** Two events arriving with identical `updatedAt` — the one with the lexicographically higher `controllerId` wins (or document the chosen tie-break in a comment and assert it).

**Pass criteria:** State machine is deterministic and LWW is strictly enforced.

---

### U9 — `useWatchSync`: own-echo suppression

**Test file:** `src/lib/watch/use-watch-sync.test.ts`

**Preconditions:** Local participant identity is `"user-A"`.

- **U9a:** When `onPlayerEvent({ kind: "play", positionSec: 10 })` is called, an event is published onto the channel with `controllerId: "user-A"`.
- **U9b:** When that same event echoes back from the channel with `controllerId: "user-A"`, `controls.current.play()` is NOT called a second time (the handle's `play` method is called zero additional times).

**Pass criteria:** The player handle's `play` method call count does not increment on own-echo.
This guards AC2's "acting participant's own player does not double-toggle" requirement.

---

### U10 — `useWatchSync`: drift-correction seek threshold

**Test file:** `src/lib/watch/use-watch-sync.test.ts`
**Setup:** Use `vi.useFakeTimers()` to control `Date.now()`.

- **U10a:** Heartbeat arrives with `positionSec = 60`, `updatedAt = Date.now() - 2000` (2 s ago). Computed remote position = 62 s. Local position (via `controls.current.getPosition()`) = 60.5 s. `|62 - 60.5| = 1.5 s`. Assert `controls.current.seek` is called (boundary inclusive or exclusive — assert whichever the implementation documents, and note it in the test).
- **U10b:** Same heartbeat but local position = 61 s. `|62 - 61| = 1.0 s < 1.5 s`. Assert `controls.current.seek` is NOT called.
- **U10c:** Heartbeat has `controllerId` matching local identity. Assert drift correction does NOT run (only non-controllers correct against the heartbeat).

**Pass criteria:** Seek fires at and above the 1.5 s threshold, not below. Controller exemption holds.

---

### U11 — `useWatchSync`: publish rate limiter caps at 10 events/sec

**Test file:** `src/lib/watch/use-watch-sync.test.ts`
**Setup:** `vi.useFakeTimers()`. Call `onPlayerEvent` 11 times within a 1 s window.

- **U11a:** The channel's `sendEvent` spy is called exactly 10 times; the 11th call is dropped locally.
- **U11b:** After the bucket refills (advance fake timer by 1 s), a subsequent call goes through.

**Pass criteria:** Leaky-bucket cap is hard at 10/sec. Excess events are silently dropped, not queued.

---

## 2. Integration tests (single-browser, mocked LiveKit)

Run with: `npx vitest run src/` (these are Vitest tests using React Testing Library with `jsdom` environment — add `environment: "jsdom"` override via `vitest.config.ts` `environmentMatchGlobs` or a per-file `@vitest-environment jsdom` comment).

These tests use a mocked `useRoomChannel` and a mocked `useWatchSync` to test rendering behavior in isolation. No real LiveKit connection.

### I1 — `<WatchPanel />` renders "not supported" state for an unsupported URL

**Preconditions:** `WatchPanel.tsx` implemented per W-1.1-F6/F8. `useWatchSync` mocked to return `{ watchState: { status: "idle" } }`. `detectProvider` mocked to return `null`.

**Steps:**
1. Render `<WatchPanel />` within providers.
2. Type `https://www.wikipedia.org/wiki/Film` into the URL input.
3. Submit (press Enter or click Load).

**Expected result:** Inline error message renders below the input. Player iframe is absent from the DOM. No event is published onto the channel.

**Pass criteria:** Error text is present in the DOM; `sendEvent` spy call count is 0.
**Validates:** AC1 (invalid URL path), F8 unsupported-URL state.

---

### I2 — `<WatchPanel />` renders load state and dispatches provider for a YouTube URL

**Preconditions:** `useWatchSync` mocked; `detectProvider` returns a YouTube provider stub.

**Steps:**
1. Render `<WatchPanel />`.
2. Paste `https://www.youtube.com/watch?v=abc123`.
3. Submit.

**Expected result:** `publishLoad("youtube", "abc123")` is called on the mocked hook. The provider's `Component` is rendered with `mediaId="abc123"`.

**Pass criteria:** `publishLoad` called once with correct arguments. Provider component in DOM.
**Validates:** AC1 (happy path load), W-1.1-F6 provider dispatch.

---

### I3 — `<WatchPanel />` renders "Join playback" button on autoplay block

**Preconditions:** `watchState.status === "active"`. YouTube provider component mock fires `onEvent({ kind: "autoplay-blocked" })` on mount.

**Steps:**
1. Render `<WatchPanel />` with active watch state.

**Expected result:** "Join playback" (or PM-finalised copy) button is present in the DOM. The button is keyboard-reachable. After clicking it, `controls.current.play()` is called once.

**Pass criteria:** Button renders; play is called on click; button disappears after playback starts (assert DOM removal after state update).
**Validates:** W-1.1-F3 autoplay policy, W-1.1-F6 autoplay affordance.

---

### I4 — `<WatchPanel />` renders DRM notice on first open

**Preconditions:** Fresh render (no session state). `watchState.status === "idle"`.

**Steps:**
1. Render `<WatchPanel />`.

**Expected result:** DRM notice text ("Netflix, Prime, Disney+ and HBO won't work here…") is present in the DOM. URL input is enabled.

**Pass criteria:** Notice text in DOM; input not disabled.
**Validates:** AC8.

---

### I5 — Mutual exclusion: Watch Mode active disables Share a tab

**Preconditions:** `watchState.status === "active"`. `screenShareActive = false`.

**Steps:**
1. Render the room layout with `<WatchPanel />` and the Share a tab button.

**Expected result:** The Share a tab button has `disabled` attribute set (or `aria-disabled="true"` with pointer-events: none). Visible reason text is present adjacent to the button.

**Pass criteria:** Button is not clickable (assert `disabled` or equivalent). Reason text in DOM.
**Validates:** AC7.

---

### I6 — Mutual exclusion: screen-share active disables Watch Mode URL input

**Preconditions:** `watchState.status === "idle"`. `screenShareActive = true`.

**Steps:**
1. Render the room layout.

**Expected result:** Watch Mode URL input has `disabled` attribute. Reason text visible.

**Pass criteria:** Input is `disabled`. Reason text in DOM.
**Validates:** AC7.

---

### I7 — Rate limiter: 11 rapid publishes in <1 s sends exactly 10

**Preconditions:** Real `useWatchSync` hook with a mocked `sendEvent`. `vi.useFakeTimers()`.

**Steps:**
1. Call `onPlayerEvent` 11 times synchronously within a fake 900 ms window.

**Expected result:** `sendEvent` called exactly 10 times.

**Pass criteria:** Spy call count === 10.
**Validates:** ADR 0006 §"Security defaults" publish rate limit.

---

## 3. Two-browser E2E tests

**Runner:** Playwright. Each test opens two browser contexts (A and B) in the same room.
**Setup:** Real app running at `http://localhost:3000`. Real LiveKit credentials required (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` in `.env.local`). YouTube IFrame API loaded from `https://www.youtube.com` — network access required.
**Test data:** QA runner picks URLs exclusively from `test/fixtures/watch-urls.ts` (file to be created — see section 5 below). Never hardcode URLs inline.

Run with: `npx playwright test`

---

### E1 — Happy path: YouTube URL loads same media for all participants (AC1/AC2)

**Preconditions:** Room created. Browser A (host) and Browser B (guest) both joined, voice connected.

**Steps:**
1. Browser A opens Watch Mode, pastes the `PUBLIC_DOMAIN_SHORT` fixture URL, submits.
2. Wait up to 3 s.

**Expected result:**
- Browser B's DOM contains the YouTube `<iframe>` with the same `mediaId`.
- Both browser contexts report audio not muted (assert `videoElement.muted === false` or equivalent on the iframe's inner video where accessible).
- No "Share tab audio" prompt appeared on either browser.

**Pass criteria:** Iframe present in B within 3 s; no audio-picker modal detected.
**Validates:** AC1, AC2.

---

### E2 — Play/pause sync: A pauses, B reflects within 500 ms (AC2)

**Preconditions:** Watch Mode active in room. Video playing on both A and B.

**Steps:**
1. Record `t0 = Date.now()` on Browser A.
2. Browser A clicks pause on the player.
3. Poll Browser B's player state until `playbackState === "paused"` or 1 s elapses.

**Expected result:** B's state changes to `paused` and the elapsed time `t1 - t0 <= 500 ms`.

**Pass criteria:** State matches within 500 ms. Repeat in reverse (B plays, A must reflect within 500 ms).
**Validates:** AC2. Note: 500 ms is a median target; allow up to 800 ms for CI network variance with a clear comment.

---

### E3 — Seek sync: A seeks to 60 s, B within 1.5 s of position within 3 s (AC3)

**Preconditions:** Watch Mode active, video playing, both participants past the 30 s mark.

**Steps:**
1. Browser A seeks to 60 s via the player API.
2. Wait 3 s.
3. Assert Browser B's `currentTime` is in `[58.5, 61.5]`.

**Expected result:** B's playhead is within ±1.5 s of 60 s within 3 s. Playback state (playing or paused) on B matches A's state before the seek.

**Pass criteria:** `Math.abs(B.currentTime - 60) <= 1.5`.
**Validates:** AC3.

---

### E4 — Late joiner catches up within 1.5 s on first render (AC4)

**Preconditions:** Browser A has been playing the video for at least 45 s.

**Steps:**
1. Browser B opens the room URL and joins (navigates to `/room/[code]` and enters nickname).
2. Without clicking anything, observe Browser B's player state on first render.

**Expected result:**
- Same video is loaded (same `mediaId`).
- `Math.abs(B.currentTime - A.currentTime) <= 1.5` within 500 ms of B's first render.
- `B.playbackState === A.playbackState`.
- No manual user action required on B's side.

**Pass criteria:** Position delta ≤ 1.5 s; state matches; no click required.
**Validates:** AC4.

---

### E5 — Firefox host can start Watch Mode and sync with Chrome guest (AC5)

**Preconditions:** Browser A = Firefox (latest stable). Browser B = Chrome.

**Steps:** Repeat E1 with Firefox as context A.

**Expected result:** Same pass criteria as E1. Firefox-specific: no "Share tab audio" failure path triggered; no `getDisplayMedia` error in console.

**Pass criteria:** Identical to E1.
**Validates:** AC5.

---

### E6 — Safari host can start Watch Mode and sync with Chrome guest (AC5)

**Preconditions:** Browser A = Safari (latest stable, macOS). Browser B = Chrome.

**Steps:** Repeat E1 with Safari as context A.

**Pass criteria:** Identical to E1. Note Safari `WKWebView` autoplay restrictions — the "Join playback" button may appear on both sides; assert it resolves after one click.
**Validates:** AC5.

---

### E7 — Stop Watch Mode clears video for all participants (AC6)

**Preconditions:** Watch Mode active on both A and B.

**Steps:**
1. Browser B (not the one who started Watch Mode) clicks "Stop Watch Mode".
2. Wait 2 s.

**Expected result:**
- Player iframe is removed from both A's and B's DOM within 2 s.
- Voice + video continues (LiveKit participant tiles still visible).
- The Share a tab button on both A and B is no longer disabled.
- URL input on both is reset (empty).

**Pass criteria:** Iframe absent in DOM for both A and B; share button enabled; voice tiles still rendered.
**Validates:** AC6.

---

### E8 — Watch Mode and screen-share are mutually exclusive in UI (AC7)

**Preconditions:** Browser A starts a screen-share (Share a tab).

**Steps:**
1. Browser B attempts to open Watch Mode and paste a YouTube URL.

**Expected result:** Watch Mode URL input is visibly disabled on B. The reason text is present. Submitting the URL (if input is forcibly enabled via DevTools) does not broadcast a `watch/load` event — the client-side gate fires first.

**Pass criteria:** Input `disabled`; reason text visible; `sendEvent` not called.
**Validates:** AC7.

---

### E9 — Unsupported URL shows "not supported" to both browsers (AC8 — unsupported URL path)

**Preconditions:** Watch Mode idle.

**Steps:**
1. Browser A pastes the `NETFLIX_URL` fixture URL and submits.

**Expected result:**
- Browser A shows the inline unsupported-URL error message.
- Browser B's state is unchanged — no `watch/load` event was broadcast.
- DRM copy ("Netflix, Prime, Disney+ and HBO won't work here…") is visible on A's URL input area.

**Pass criteria:** Error on A; B untouched; DRM copy visible.
**Validates:** AC1 (invalid URL path), AC8.

---

### E10 — Screen-share DRM black frame is unchanged by Watch Mode shipping (AC7 carry-over)

**Preconditions:** Browser A screen-shares a Chrome tab playing Netflix (or any DRM-protected content).

**Steps:**
1. Observe Browser B's incoming video stream.

**Expected result:** B sees a black frame (or the browser's DRM placeholder frame) for A's screen-share. Watch Mode is NOT active; this is pure screen-share. The test confirms Watch Mode did not accidentally resolve the DRM limitation.

**Pass criteria:** B receives no decoded video content (black frame confirmed). This is a negative test — it must stay failing in the sense that DRM remains blocked. Flag if B unexpectedly sees real video content.
**Validates:** AC7 DRM caveat, W-MVP AC7 regression.

---

### E11 — Controller "Controlled by X" pill updates on LWW winner

**Preconditions:** Watch Mode active. A is current controller.

**Steps:**
1. B clicks play/pause.
2. Within 200 ms, A also clicks play/pause (simulating a fight within the LWW window).
3. Wait 500 ms for state to settle.

**Expected result:**
- The "Controlled by" pill on both A and B shows the identity of the participant whose event had the higher `updatedAt` (the LWW winner).
- Only one play/pause state is displayed (no flicker between playing and paused persisting beyond 500 ms).

**Pass criteria:** Pill shows a single identity; playback state is stable (not toggling) after 500 ms.
**Validates:** ADR 0006 LWW arbitration, controller display (W-1.1-F6).

---

### E12 — Cross-browser audio parity: Firefox A + Chrome B

**Preconditions:** Watch Mode active. `PUBLIC_DOMAIN_SHORT` URL loaded.

**Steps:**
1. Both participants play the video.
2. On each browser, assert the underlying `<video>` element inside the iframe is not muted and is producing audio (`audioTracks.length > 0` or equivalent WebAudio API check).

**Expected result:** Audio track is active and unmuted on both Firefox and Chrome. This is the primary pain point Watch Mode exists to solve (W-MVP failure mode: Firefox cannot capture tab audio via screen-share).

**Pass criteria:** Audio active on both. Any muted or missing audio track is a release blocker.
**Validates:** US4 (Firefox/Safari works), AC1 core audio value prop.

---

### E13 — Cross-browser audio parity: Safari A + Chrome B

**Preconditions:** Same as E12 but Safari replaces Firefox as context A.

**Pass criteria:** Same as E12. Safari autoplay policy may require the "Join playback" click — that is acceptable; silence is not.
**Validates:** US4, AC1.

---

## 4. Performance and bundle tests

These are manual checks executed once per PR that touches `WatchPanel.tsx`, `youtube.ts`, or `RoomClient.tsx`. Record output in the PR description.

### P1 — `/` route has zero bytes of Watch Mode code

**Procedure:**
1. Run `npx next build`.
2. Inspect the route-chunk output for `/` (the `static/chunks/pages/index*` or `app/page*` chunk).
3. `grep -r "watch" .next/static/chunks/` — confirm no chunk attributable to the `/` route contains strings from `src/lib/watch/` or `youtube-nocookie.com`.

**Pass criteria:** Zero occurrences of Watch Mode module identifiers in the `/` route bundle.
**Validates:** ADR 0006 bundle discipline, W-1.1-F7.

---

### P2 — `/room/[code]` pre-Watch-Mode chunk has zero bytes of `youtube.ts`

**Procedure:**
1. Inspect the main chunk for `/room/[code]`.
2. Confirm `youtube-nocookie.com` and `iframe_api` string literals are absent from the main chunk (they must appear only in the dynamically loaded chunk triggered by URL submission).

**Pass criteria:** Strings absent from main chunk. Delta on main chunk vs. pre-Watch-Mode baseline < 1 KB gzipped.
**Validates:** W-1.1-F7 lazy-load boundary.

---

### P3 — p95 play/pause propagation latency on broadband

**Procedure:** During E2 execution, record timestamps at the moment the play/pause event is emitted by A (`Date.now()` before `sendEvent`) and the moment B's player state changes. Run the E2 scenario 20 times (automate with a loop in the Playwright test). Compute p95 of the 20 round-trip durations.

**Pass criteria:** p95 ≤ 500 ms. If p95 is 501–700 ms on a broadband connection, flag as a warning (not a blocker) and open an issue. Above 700 ms is a release blocker.
**Validates:** AC2 sync tolerance.

---

## 5. Test data and fixtures

**File to create:** `test/fixtures/watch-urls.ts`

The QA runner must populate this file with real, curated URLs before executing E2E tests. The file must export the following named constants. Do not invent URLs in this plan — the constants below are named slots; actual values are filled in by the QA engineer before W-1.1 QA begins.

```ts
// test/fixtures/watch-urls.ts
export const WATCH_URLS = {
  // A short (<5 min) public-domain or CC-licensed clip on YouTube
  PUBLIC_DOMAIN_SHORT: "https://www.youtube.com/watch?v=<TBD>",

  // A long-form (>60 min) public clip, for late-joiner and seek tests
  LONG_FORM: "https://www.youtube.com/watch?v=<TBD>",

  // A YouTube Short (vertical-format)
  YOUTUBE_SHORT: "https://www.youtube.com/shorts/<TBD>",

  // youtu.be short-link form
  YOUTU_BE_SHORT_LINK: "https://youtu.be/<TBD>",

  // A video the uploader has disabled embedding (embed-refused path)
  // Verify before use: player must fire onError code 101 or 150
  EMBED_DISABLED: "https://www.youtube.com/watch?v=<TBD>",

  // A video that is region-locked outside the expected test region
  // Note: this test is inherently environment-dependent; skip if running in unaffected region
  REGION_LOCKED: "https://www.youtube.com/watch?v=<TBD>",

  // A Netflix URL to trigger the unsupported-provider path
  NETFLIX_URL: "https://www.netflix.com/watch/12345",

  // An arbitrary valid HTTPS URL that is not a supported provider
  UNSUPPORTED_VALID: "https://www.wikipedia.org/wiki/Film",
} as const;
```

Each URL must be verified by the QA engineer before the test run. `EMBED_DISABLED` and `REGION_LOCKED` must be re-verified on every test run cycle — YouTube can change embedding permissions without notice.

---

## 6. Manual test matrix

Execute at minimum once before the release gate sign-off. Tick each cell.

| Browser | OS | E1 | E2 | E3 | E4 | E7 | E9 | E12/E13 | Release required? |
|---|---|---|---|---|---|---|---|---|---|
| Chrome (latest) | macOS | yes | yes | yes | yes | yes | yes | reference | MUST PASS |
| Chrome (latest) | Windows 11 | yes | yes | yes | — | yes | yes | yes | MUST PASS |
| Firefox (latest) | macOS | yes | yes | yes | — | yes | yes | as A | MUST PASS (audio parity is the feature) |
| Safari (latest) | macOS | yes | yes | — | — | yes | yes | as A | MUST PASS (audio parity) |
| Chrome (latest) | Android (mobile) | smoke only | — | — | — | — | — | — | Best-effort |
| Safari | iOS | smoke only | — | — | — | — | — | — | Best-effort |

**Smoke only** = open room, paste YouTube URL, confirm player renders. Full sync tests not required for mobile at v1.1 (out-of-scope per PM spec: "Desktop-first, same as W-MVP").

---

## 7. Base MVP regression checklist

Execute manually before merging the v1.1 PR. Confirm these base MVP behaviors are unaffected.

| # | Scenario | Pass criteria |
|---|---|---|
| R1 | Create room, join with a second browser | Room code works; both browsers see participant tiles |
| R2 | Voice + video call | Audio and video visible on both sides; no regression in LiveKit tile rendering |
| R3 | Screen-share (Chrome, Tab + Share tab audio) | Guest hears audio from the shared tab; no black frame on non-DRM content |
| R4 | `canPublishData: true` grant does not enable unauthorized data floods | A participant sending > 10 events/sec is rate-limited by the client leaky-bucket; no additional server-side vector introduced |
| R5 | LiveKit disconnect/reconnect | Participant disconnects and rejoins; room state recovers; Watch Mode state is re-fetched via late-joiner handshake |
| R6 | DRM screen-share still shows black frame (E10) | Netflix/Prime/Disney+ share is a black frame on the guest side; Watch Mode did not alter this |

---

## 8. Release gate

The following tests MUST pass before Watch Mode v1.1 is deployed to production. A single failure in this set blocks the release.

**Unit (automated — `npm test` green):**
- U1 (all accepted shapes)
- U2 (all rejection codes)
- U7 (all envelope round-trips, including `null` drop on malformed)
- U8, U9, U10, U11 (`useWatchSync` reducer correctness)

**Integration (automated — `npm test` green):**
- I1, I2, I4, I5, I6 (WatchPanel states and mutual exclusion)
- I7 (rate limiter)

**E2E (Playwright — `npm run test:e2e` green):**
- E1, E2, E3, E4 (happy path + sync on Chrome/Chrome)
- E5 or E6 (at least one of Firefox/Safari as host)
- E7 (stop)
- E9 (unsupported URL)
- E12 or E13 (at least one cross-browser audio parity pair)

**Performance:**
- P1 and P2 (bundle analysis recorded in PR description — zero Watch Mode code on `/`)

**Manual sign-off (documented in PR checklist):**
- All six rows of the base MVP regression checklist (R1–R6)
- Manual browser matrix: Chrome/macOS, Chrome/Windows, Firefox/macOS, Safari/macOS — rows marked MUST PASS in section 6
- Zero CSP errors in browser devtools during a full Watch Mode session (W-1.1-B4 acceptance criterion)

**Tests that are NOT release blockers (run but do not block):**
- E6 Safari (if Safari infra is unavailable in CI — acceptable as manual-only for v1.1)
- E10 DRM black-frame (manual-only; cannot be automated without DRM content access)
- E11 LWW fight (timing-sensitive; treat as best-effort in CI; must pass in manual run)
- P3 latency p95 (warning threshold 500–700 ms; only above 700 ms is a hard block)
- Mobile smoke tests
