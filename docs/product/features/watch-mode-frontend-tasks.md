# Watch Mode v1.1 — Frontend Implementation Task Spec

**Status:** Planning
**Milestone:** W-1.1 (after W5 review passes on the base MVP)
**Owner:** Frontend specialist
**Depends on:** W-MVP shipped (W3 + W4 + W5 done), `canPublishData: true` confirmed in token grant (PM open-question #1 — must be resolved before W-1.1 starts; ADR 0005 §8 flips this grant for W-P2 anyway, so coordinate with whichever milestone lands first).

## Repo conventions to match

All code lives under `src/`. The room page is `src/app/room/[code]/`. Shared
modules live in `src/lib/`. Data-channel logic follows the pattern in
`src/lib/room/envelope.ts` (Zod schemas, `encodeEvent` / `decodeEvent`) and
`src/lib/room/use-room-channel.tsx` (context + `sendEvent` + `subscribe`).
Tests sit alongside the file they cover (`foo.ts` + `foo.test.ts`). Client
components carry `"use client"` at the top; everything else is server-safe by
default. `next/dynamic` with `ssr: false` is the lazy-load idiom already used
in this codebase.

---

## Work items

### W-1.1-F1 — URL validation helper

**New file:** `src/lib/watch/validate-url.ts`

Pure function, no I/O, importable from both client and server code. Implements
the security contract from ADR 0006 §"No new backend surface": parse with
`new URL(...)`, reject any protocol other than `https:` (and `http:` in dev
only, gated on `process.env.NODE_ENV`), reject `javascript:` / `data:` /
`file:` / `blob:` explicitly, and reject any hostname matching RFC1918,
loopback, link-local, or `.local` ranges. Returns the normalised `URL` or
throws a typed `InvalidWatchUrl` error class. No regex duplication: the
provider matchers in W-1.1-F2 will import and call this first, not re-check
protocols themselves.

**Acceptance criteria:**
- `validateUrl("https://www.youtube.com/watch?v=abc")` returns a `URL`.
- `validateUrl("javascript:alert(1)")` throws `InvalidWatchUrl`.
- `validateUrl("http://192.168.1.1/secret")` throws `InvalidWatchUrl`.
- `validateUrl("http://localhost:3000")` throws in production, returns in dev
  (`NODE_ENV === "development"`).
- The function carries no browser API calls — it must be importable in a
  Next.js API route or a Vitest test without mocking.

**Test coverage:** `src/lib/watch/validate-url.test.ts` — Vitest, no browser.
Cover all protocol rejection cases, all RFC1918/loopback ranges, the dev-mode
`http:` gate, and a clean round-trip for a valid HTTPS URL.

---

### W-1.1-F2 — Provider registry scaffold

**New files:**
- `src/lib/watch/providers/index.ts` — registry array + `detectProvider`
- `src/lib/watch/types.ts` — shared interfaces

Defines the shared types and the registry lookup. Exact TypeScript interface,
matching ADR 0006:

```ts
// src/lib/watch/types.ts
export type PlayerEvent =
  | { kind: "ready" }
  | { kind: "play";  positionSec: number }
  | { kind: "pause"; positionSec: number }
  | { kind: "seek";  positionSec: number };

export interface ProviderPlayerHandle {
  play(): void;
  pause(): void;
  seek(sec: number): void;
  getPosition(): number;
}

export interface ProviderPlayerProps {
  mediaId: string;
  onEvent: (e: PlayerEvent) => void;
  controls: React.RefObject<ProviderPlayerHandle | null>;
}

export interface Provider {
  id: string;
  matches(url: URL): boolean;
  extractMediaId(url: URL): string | null;
  Component: React.ComponentType<ProviderPlayerProps>;
}
```

`src/lib/watch/providers/index.ts` exports a `PROVIDERS: Provider[]` array
and `detectProvider(rawUrl: string): { provider: Provider; mediaId: string } | null`.
`detectProvider` calls `validateUrl` first (from W-1.1-F1); if that throws it
returns `null`. Then it walks `PROVIDERS` in order and returns the first
`matches()` hit with the extracted `mediaId`, or `null` if none match.
Registry order defines precedence; a future generic-iframe fallback goes last.

**Acceptance criteria:**
- Adding a second provider requires one new file under `providers/` and one
  new entry in the `PROVIDERS` array. `detectProvider`, `WatchPanel`, and
  `useWatchSync` need no edits. This is the AC9 code-shape gate.
- `detectProvider("not a url")` returns `null` without throwing.
- `detectProvider` is a pure function testable in Vitest without a browser.

**Test coverage:** `src/lib/watch/providers/index.test.ts` — Vitest. Test
`detectProvider` with a valid YouTube URL, an unsupported-but-valid URL, a
malformed string, and a private-network URL. Do not test provider internals
here; those belong in the provider's own test file.

---

### W-1.1-F3 — YouTube provider

**New file:** `src/lib/watch/providers/youtube.ts`

Implements the `Provider` interface for YouTube. `matches` accepts
`youtube.com/watch`, `youtu.be/`, `youtube.com/shorts/`, and
`youtube.com/embed/` URL shapes. `extractMediaId` pulls the video id (the `v`
query param on `/watch`, the path segment on `youtu.be/` and `/shorts/`). The
`Component` (a `"use client"` React component) renders an `<iframe>` to
`https://www.youtube-nocookie.com/embed/{mediaId}?enablejsapi=1&origin=...`
with the sandbox attributes from ADR 0006 (`allow-scripts allow-same-origin
allow-presentation` — no `allow-forms`, `allow-popups`, or
`allow-top-navigation`). The `origin` parameter is set to
`window.location.origin` at mount time, not a hardcoded value; this handles
Vercel preview URLs with per-deploy origins (ADR 0006 open question).

The YouTube IFrame API script (`https://www.youtube.com/iframe_api`) is
injected by a `useEffect` on first mount — never at module import time, never
bundled. The component exposes `ProviderPlayerHandle` via the forwarded `controls`
ref: `play()` → `player.playVideo()`, `pause()` → `player.pauseVideo()`,
`seek(sec)` → `player.seekTo(sec, true)`, `getPosition()` →
`player.getCurrentTime()`. It emits normalised `PlayerEvent`s via `onEvent` on
`onStateChange` (play → emit `{ kind: "play", positionSec }`, pause → emit
`{ kind: "pause", positionSec }`, buffering does not emit) and `onReady` (emit
`{ kind: "ready" }`).

Autoplay policy: the first `watch/play` a joining participant receives may be
blocked by the browser without a prior user gesture. The component detects this
via the YT player's `playVideo` returning without transitioning to PLAYING
state (or catching the `NotAllowedError` on the underlying `<video>` element)
and calls `onEvent({ kind: "autoplay-blocked" })` so `<WatchPanel />` can
render the "Join playback" affordance (W-1.1-F5). `autoplay-blocked` is a
client-local signal; it does not go onto the data channel.

**Acceptance criteria:**
- `matches` returns `true` for all four URL shapes listed above; returns
  `false` for `vimeo.com`, `twitch.tv`, and bare hostnames.
- `extractMediaId("https://youtu.be/dQw4w9WgXcQ")` returns `"dQw4w9WgXcQ"`.
- The `<iframe>` carries `sandbox="allow-scripts allow-same-origin
  allow-presentation"` and no other sandbox tokens.
- The IFrame API script is not present in the DOM until the `Component` mounts
  for the first time. Subsequent mounts do not inject a duplicate `<script>`.
- `origin` in the embed URL matches `window.location.origin` at mount, not a
  hardcoded domain.
- The component renders nothing (or a loading state) until `onReady` fires; it
  does not attempt player API calls before that.

**Test coverage:** `src/lib/watch/providers/youtube.test.ts` — Vitest for
`matches` and `extractMediaId` (pure functions, no browser). Component
rendering is left to manual/E2E; unit-testing the IFrame API integration adds
more test-surface than it protects.

---

### W-1.1-F4 — Envelope extension and Zod schemas

**Modified file:** `src/lib/room/envelope.ts`

Adds six new Zod schemas to the existing envelope and extends `RoomEventSchema`
to include them. Follows the exact pattern of existing schemas in that file.
New types per ADR 0006:

| Type literal | Kind | Key payload fields |
|---|---|---|
| `watch/load` | RELIABLE | `providerId: string`, `mediaId: string`, `controllerId: string` |
| `watch/play` | RELIABLE | `positionSec: number`, `controllerId: string` |
| `watch/pause` | RELIABLE | `positionSec: number`, `controllerId: string` |
| `watch/seek` | RELIABLE | `positionSec: number`, `controllerId: string` |
| `watch/heartbeat` | LOSSY | `positionSec: number`, `controllerId: string` |
| `watch/stop` | RELIABLE | `controllerId: string` |

All carry `v`, `ts`, and `type` per the standard envelope. `watch/stop` is
implicit in the PM's AC6 but not named in ADR 0006; it is the event that clears
Watch Mode for all participants. `watch/heartbeat` is not forwarded to the
`subscribe` path (it is consumed directly in `useWatchSync` for drift
correction). Also extend the `hello.snapshot` schema with a nullable
`watchState` field (`WatchState | null`) so late-joiner resync (W-1.1-F5) can
ride the existing handshake without a new round-trip.

**Acceptance criteria:**
- All six new schemas parse valid payloads and reject malformed ones in
  Vitest.
- Unknown `type` strings (including `"watch/load"` received by an old peer
  that doesn't have this schema) drop silently via the existing `decodeEvent`
  path — no change to `decodeEvent`'s logic needed since the union is
  extended, not the guard.
- The `hello.snapshot` Zod schema remains backward-compatible: old peers
  sending a snapshot without `watchState` decode cleanly (field is
  `.nullable().optional()`).

**Test coverage:** Extend `src/lib/room/envelope.test.ts` — round-trip encode
+ decode for each new type; confirm malformed payload drops; confirm
`hello.snapshot` with and without `watchState` parses correctly.

---

### W-1.1-F5 — `useWatchSync` hook

**New file:** `src/lib/watch/use-watch-sync.ts`

Client-only hook (`"use client"`) that owns the full Watch Mode synchronisation
loop. Consumes the existing `useRoomChannel` context (same pattern as
`WaitForMe`, `Whisper`, etc. in the room). Does not reach into LiveKit directly;
all data-channel sends go through `sendEvent`, all receives through `subscribe`.

**State it manages (local, derived from data-channel events):**

```ts
type WatchSyncState =
  | { status: "idle" }
  | {
      status: "active";
      providerId: string;
      mediaId: string;
      playbackState: "playing" | "paused";
      positionSec: number;
      updatedAt: number;
      controllerId: string;
    };
```

**Publish path.** When the local player fires a `PlayerEvent`, the hook
publishes the corresponding `watch/*` envelope event with the local participant
identity as `controllerId`. Own-echo suppression: compare `controllerId` of
every inbound event to the local identity; if equal, skip the apply step.
Rate-limit: leaky bucket at 10 events/sec across all `watch/*` types combined,
same pattern as `src/lib/room/rate-limit.ts`. Rapid seek scrubbing should not
trip this under normal usage (each drag-end emits one seek, not per-pixel).

**Receive path.** LWW on `updatedAt`. If an inbound event's `updatedAt` is
older than the current `state.updatedAt`, drop. Otherwise apply and, if the
event is a command (`play`/`pause`/`seek`), call the corresponding
`ProviderPlayerHandle` method via the forwarded `controls` ref.

**Drift correction.** When `playbackState === "playing"` and local identity is
the `controllerId`, publish `watch/heartbeat` every 3 s (via a `setInterval`
cleared on `status !== "active"` or `playbackState !== "playing"`). On
receiving a heartbeat from a different `controllerId`, compare
`remote.positionSec + (Date.now() - remote.updatedAt) / 1000` to
`controls.current.getPosition()`. If `|diff| > 1.5`, call
`controls.current.seek(remote.positionSec + age)`.

**Late-joiner resync.** Extends the existing `hello` handshake in
`use-room-channel.tsx`. The joiner already broadcasts `hello.request` on
`RoomEvent.Connected`; peers reply with `hello.snapshot`. Watch Mode adds
`watchState` to the snapshot reply (W-1.1-F4). On receiving a snapshot with
non-null `watchState`, the hook calls `controls.current.seek(positionSec +
age)` then `play()` or `pause()` per `playbackState`. If no snapshot arrives
within 1.5 s, assume Watch Mode is not active. The hook does not need to send
its own `hello`; it taps the existing one by subscribing to `hello.snapshot`
events via `subscribe`.

**Hook return value:**

```ts
{
  watchState: WatchSyncState;
  publishLoad(providerId: string, mediaId: string): void;
  publishStop(): void;
  playerRef: React.RefObject<ProviderPlayerHandle | null>;
  onPlayerEvent(e: PlayerEvent): void;  // pass to Provider.Component's onEvent
}
```

**Acceptance criteria:**
- Own-echo suppression: calling `onPlayerEvent({ kind: "play", positionSec: 0
  })` publishes onto the channel but does not call `controls.current.play()`
  again on the local handle (regression guard: avoids double-toggle).
- LWW: a `watch/play` with `updatedAt = T` followed by a `watch/pause` with
  `updatedAt = T-1` leaves state as `playing`.
- Drift correction: a heartbeat with `positionSec = 60` and `updatedAt`
  stamped 2 s ago is interpreted as position `62`; if local position is `60.5`,
  diff = 1.5 — at the boundary, seek fires (spec says `> 1.5 s`, so at
  exactly 1.5 the behavior is implementation-defined; document the chosen
  boundary in a comment).
- Rate limiter: 11 rapid publishes in < 1 s results in exactly 10 messages
  sent, the 11th dropped.

**Test coverage:** `src/lib/watch/use-watch-sync.test.ts` — Vitest + React
Testing Library. Mock `useRoomChannel` (same pattern as existing hook tests).
Unit-test the LWW reducer, drift-correction math, own-echo guard, and rate
limiter as pure functions extracted from the hook. The heartbeat interval and
late-joiner timeout use fake timers (`vi.useFakeTimers`).

---

### W-1.1-F6 — `<WatchPanel />` component

**New file:** `src/app/room/[code]/WatchPanel.tsx`

Client component (`"use client"`) that owns the entire Watch Mode UI surface
inside `/room/[code]`. Mounted by `RoomClient.tsx` under the same
`RoomChannelProvider` context so it can call `useWatchSync` (W-1.1-F5).

**Layout responsibilities:**
- **URL bar.** Text input labelled "Watch together — paste a YouTube link"
  (visible label, not placeholder-only). On submit: call `detectProvider` (W-1.1-F2);
  on `null`, show the unsupported-URL inline error (PM to finalise copy —
  placeholder: "That URL isn't supported yet — YouTube only for now"); on
  match, call `publishLoad` from `useWatchSync`.
- **DRM notice.** Rendered below the URL input on first open in the session
  (per AC8). Suggested placeholder copy: "Netflix, Prime, Disney+ and HBO won't
  work here. Use Share a tab for those (guests will see a black frame — that's
  a browser DRM restriction, not a bug)." PM to finalise.
- **Provider dispatch.** When `watchState.status === "active"`, renders the
  matched `Provider.Component` (resolved via `detectProvider` against the
  stored `mediaId` — or cached from the `watch/load` event). Nothing else in
  this file knows which provider is mounted; the registry interface is the only
  coupling.
- **"Controlled by X" pill.** When Watch Mode is active, renders a pill with
  the display name of `controllerId`'s participant (resolved from the LiveKit
  room's participant list — use the same name-lookup pattern as the existing
  tile renderer). Announces controller changes to screen readers with
  `aria-live="polite"` on the pill's container.
- **"Join playback" button.** Rendered when the YouTube provider fires the
  `autoplay-blocked` signal (W-1.1-F3). One click calls `controls.current.play()`.
  Copy placeholder: "Tap to join playback". PM to finalise.
- **"Stop Watch Mode" button.** Always visible while `watchState.status ===
  "active"`. Calls `publishStop()`. Any participant can press it (AC6 / PM
  open-question #6 — "any participant" posture; flag in a TODO comment for PM
  to override if needed). On press, triggers `watch/stop` which clears Watch
  Mode for all participants.
- **Mutual exclusion with Share a tab.** Reads the screen-share active state
  from the existing `RoomClient` context (same source the `ShareRequest` toast
  uses). When a screen-share is active, disable and visually mark the Watch
  Mode URL input. When Watch Mode is active, pass a boolean prop to the
  existing share-tab button disabling it (or surface via the `RoomChannelProvider`
  context). Copy placeholder: "Stop Watch Mode first" / "Someone is
  screen-sharing — stop that first". PM to finalise.

**Accessibility requirements:**
- URL input has a `<label>` (not `aria-label` as a shortcut).
- The provider iframe itself has `title="Watch together player"` so screen
  readers announce it on focus-in.
- "Stop Watch Mode" button is `<button>`, never a `<div>` handler.
- Focus is managed when Watch Mode activates: focus moves to the "Join
  playback" button (if rendered) or to the player iframe, not lost.
- Controller-change announcements via `aria-live="polite"` on the pill.

**Acceptance criteria:**
- URL bar is keyboard-navigable (Tab to input, Enter to submit, Escape to
  clear unsupported-URL error state).
- "Join playback" button appears within one React render after the YouTube
  component fires `autoplay-blocked`; it disappears after playback starts.
- When Watch Mode is active, the share-tab button is visibly disabled.
- When screen-share is active, the Watch Mode URL input is visibly disabled.
- "Stop Watch Mode" is reachable via keyboard from the room's natural tab order.
- DRM notice renders on first open; it does not block the input.
- PM-placeholder copy lines are marked with `{/* TODO: PM to finalise copy */}`
  comments so they are findable in a review pass.

**Test coverage:** Render test with React Testing Library: assert URL bar is
labelled, assert provider dispatch renders the matched provider, assert DRM
notice is present on first render, assert mutual-exclusion disabled states.
Use a mock `useWatchSync` that returns canned state.

---

### W-1.1-F7 — Lazy-load boundary and bundle discipline

**Modified file:** `src/app/room/[code]/RoomClient.tsx`

`<WatchPanel />` and the YouTube provider `Component` must not appear in the
initial bundle for `/` or in the pre-Watch-Mode chunk for `/room/[code]`.
Import `WatchPanel` via `next/dynamic`:

```ts
const WatchPanel = dynamic(
  () => import("./WatchPanel"),
  { ssr: false, loading: () => null }
);
```

The YouTube provider `Component` is itself `next/dynamic` inside
`youtube.ts` (the `Provider` interface's `Component` field holds the lazily
resolved type — the registry `PROVIDERS` array is light; only the component
is deferred). The IFrame API `<script>` injection happens inside the component
effect, not at registry import time.

**Bundle check.** After this task ships, run `next build` and inspect the
route-chunk output. The chunk for `/room/[code]` must not contain the YouTube
IFrame API wrapper, the `WatchPanel` render tree, or any string literal from
`youtube-nocookie.com` in the main chunk (they should appear only in the
dynamically loaded chunk). This is a manual step at PR review time (per ADR
0006 "automated bundle-size regression alert" deferred to post-W-1.1); the PR
description must include the `next build` output snapshot.

**Acceptance criteria:**
- `WatchPanel` is absent from the Webpack module graph of the `/` route.
- The YouTube IFrame API script is not requested by the browser until a
  YouTube URL is submitted and the provider component mounts.
- Adding `WatchPanel` to `RoomClient.tsx` does not measurably increase the
  initial route chunk (threshold: < 1 KB gzipped delta on the main chunk).

**Test coverage:** No automated test. Manual bundle inspection at PR time;
recorded in the PR description as a required checklist item.

---

### W-1.1-F8 — Empty, error, and unsupported states

**Modified file:** `src/app/room/[code]/WatchPanel.tsx` (same file as F6)

Explicit design for all non-happy-path states. Each state is a distinct render
path in `<WatchPanel />`; none silently no-ops.

| State | Trigger | Render |
|---|---|---|
| No URL entered | `watchState.status === "idle"` | URL bar with DRM notice. No player. |
| Unsupported URL | `detectProvider` returns `null` | Inline error below the input. PM to finalise copy (placeholder: "That URL isn't supported yet — YouTube only for now"). Input remains editable. |
| Embed refused | YouTube fires `onError` with code 101 or 150 (embedding disabled), or 100/150 (not found / private) | Inline error rendered by the provider component via `onEvent({ kind: "error", code })`. `WatchPanel` listens for this via an extended `PlayerEvent` variant and shows: "YouTube won't let this video play embedded — try another link." PM to confirm copy and whether to broadcast the error to the room or keep it per-viewer (placeholder: per-viewer). |
| SDK load failure | The IFrame API `<script>` fires `onerror` | The YouTube component emits a `PlayerEvent` error variant; `WatchPanel` renders "The YouTube player couldn't load — check your connection." |
| Watch Mode idle, screen-share active | `screenShareActive && watchState.status === "idle"` | URL input disabled, reason text visible. |

PM copy lines are placeholder; each is marked `{/* TODO: PM copy */}`.

**Acceptance criteria:**
- Every state is reachable by a developer reading the component without tracing
  external state — each branch is an explicit `if` / `switch`, not a
  suppressed render.
- Error states do not leak technical details (no `YT.PlayerError` enum values,
  no raw exception messages) into the rendered UI.
- Error states are announced to screen readers (`role="alert"` or `aria-live`
  on the error container).

**Test coverage:** React Testing Library render tests for idle state (URL bar
present, player absent) and unsupported-URL state (inline error rendered after
a submit with a non-YouTube URL). Embed-refused and SDK-failure states: verify
the error container renders given the mocked `onEvent` error signal.

---

## Non-goals for v1.1

These must not appear in any PR against this milestone. If a PR adds one,
close it and open a new spec first.

- **Persistent playback history.** No DB, same posture as W-MVP.
- **Queue or playlist.** One active video at a time. Advancing = paste a new URL.
- **Playback-rate sync** (1.25x, 2x). The wire format supports it later; don't build it now.
- **Live-stream DVR seek.** YouTube live works only insofar as play/pause on the live edge is meaningful.
- **Reactions, chat overlay, or any UI on the video surface.** Reactions are a W-P2 feature (ADR 0005 §6).
- **Any provider other than YouTube.** The registry is ready; the day-one list is intentionally one entry.
- **DRM sites.** No embed exists. Screen-share fallback with the W-MVP AC7 caveat is the documented story.
- **Mobile-optimised layouts.** Desktop-first, same as W-MVP.
- **Server-side URL preflight route.** `validate-url.ts` is server-safe if needed later; no API route in W-1.1.
- **Automated bundle-size CI gate.** Manual inspection at PR time; automate post-W-1.1.
