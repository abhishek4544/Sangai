# ADR 0005 — W-P2: Watch-together Phase 2 (in-room feel)

**Status:** Proposed
**Date:** 2026-09-05
**Milestone:** W-P2 (follows W-MVP / ADR 0004)

## Context

W-MVP shipped the room shell: 2–4 people join a short code, get voice + video
+ tab share, and see six placeholder buttons in the action bar that don't do
anything yet (`RoomClient.tsx` — Wait for me, Mini Date Cards, Look at me,
Whisper mode, reaction row). Watching *together* still doesn't feel like it.

Full ACs for the six features live in
`docs/product/features/watch-together-phase2.md`. This ADR is the architecture
for shipping them. PM's proposed ship order **5 → 1 → 3 → 2 → 4 → 6** is
preserved; §1 (transport) is a prerequisite for every feature and lands first.

Constraints:

1. **DRM carries forward.** Phase 1 AC7 stands. Audio-triggered features
   (Smart mic, Whisper, Cards' quiet signal) assume a non-DRM tab and no-op
   otherwise. We don't fingerprint the tab.
2. **No new services / packages.** LiveKit stays the only infra. Per
   `CLAUDE.md`: no package for something a few lines would do.
3. **Browser-only.** We can't reach into the shared tab's `<video>`
   (cross-origin) and don't drive underlying players (YouTube/Twitch/X).
   Everything operates at the LiveKit room layer or on LiveKit-owned tracks.
4. **Phase 1 leaves a bug.** `localParticipant.setName()` throws at runtime
   (`does not have permission to update own metadata`); the token grant in
   `src/lib/livekit/token.ts` sets neither `canPublishData` nor
   `canUpdateOwnMetadata`. Phase 2 needs the data channel anyway; fix in §8.

## Decision drivers

- **LiveKit primitives already open.** `publishData` (RELIABLE/LOSSY),
  `DataReceived`, participant attributes, `TrackSubscribed`, per-track
  `attach()`. Consume these before anything else.
- **Web Audio API** for §4 (duck) and §5 (VAD): `MediaStreamAudioSourceNode`
  → `GainNode` / `AnalyserNode` → destination. Zero deps.
- **Keep serverless.** No state on the mint side. Room state lives in the
  LiveKit room.
- **Every feature degrades to no-op** per PM cross-cutting.
- **Two-person target; 3–4 must still work.**

## Considered options, per cross-cutting concern

The ADR is organized around the nine cross-cutting decisions the tech-lead
brief asked for. Each section: options → chosen path → why.

---

### 1. Signaling / data channel

**Problem.** Exchange events between participants: reactions (AC5.1), hold
(AC1.1), whisper toggle (AC4.6), cards toggle (AC6.5), catch-up hints,
force-on mic. ADR 0004 deferred `canPublishData` "if text chat or playback
sync lands." Both triggers are met.

**Options.** (A) LiveKit **data channel** — same connection, RELIABLE/LOSSY,
zero infra. (B) LiveKit **participant attributes** — durable K/V per
participant, broadcast on change; wrong shape for events. (C) LiveKit **room
metadata** — one string, requires a new server-side write route. (D) A
**separate stack** (Socket.IO / SSE / Redis) — duplicates LiveKit.

**Decision — A for events, B for durable per-participant state.**

- **Data channel** for events: reactions, hold, whisper toggle, cards
  toggle, card show/dismiss, snapshot handshake.
- **Attributes** for late-joiner-visible per-participant state:
  `p2.forceOnMic: "1" | "0"`. That's it — everything else derives locally.

**Envelope.** JSON, UTF-8 bytes:

```
{ v: 1, type: "reaction" | "hold" | "whisper" | "card" | "hello",
  ts: <unix-ms of sender>, ...payload }
```

`v` = version tag; `v !== 1` → drop silently (forward compat). Unknown
`type` → drop silently. `ts` = last-writer-wins arbiter for §2. Every
inbound message is Zod-parsed before dispatch; malformed → structured log
+ drop (same posture as ADR 0004 route validation).

**Reliability policy per type.**

| Type | Kind | Why |
|---|---|---|
| `reaction` | LOSSY | AC5.4/5.5: missed reactions OK. |
| `hold` | RELIABLE | AC1.1: 2s SLA to every participant. |
| `whisper` (`phase: "toggle"`) | RELIABLE | AC4.6: everyone's mix reflects the toggle. |
| `whisper` (`phase: "voice-on" \| "voice-off"`) | LOSSY | §4: a missed VAD edge self-heals on the next one. |
| `card` | RELIABLE | AC6.3: dismissal within 2s. |
| `hello` | RELIABLE | Snapshot request on join (§2). |

**Rejected.** D is the "add a package for what a few lines do" antipattern.
C forces a new API route and a round-trip per toggle; strictly worse than A
for events and no better than B for durable state.

---

### 2. State ownership model

**Problem.** Who owns which state; how does a reconnecting client learn
"the room is currently held" without a DB.

**Options.** (A) **Fully symmetric, event-sourced** — every client keeps a
local replica from data-channel events; reconnect via snapshot from a peer.
(B) **Host-authoritative** — breaks AC1.1 (any participant can hold; Phase 1
doesn't distinguish host from guest at the wire level anyway). (C)
**RoomService/metadata as truth** — round-trip per toggle, new API route.

**Decision — A, with a snapshot-on-join handshake.**

Every room-wide value is single-writer-wins by `ts`.

| State | Scope | Transport | Authority |
|---|---|---|---|
| `held: { by, at } \| null` (AC1.1–1.5) | Room | data channel RELIABLE | LWW `ts` |
| `whisperOn: bool` (AC4.6) | Room | data channel RELIABLE | LWW `ts` |
| `cardsEnabled: bool` (AC6.5) | Room | data channel RELIABLE | LWW `ts` |
| `currentCard: { id, at } \| null` (AC6.4) | Room | data channel RELIABLE | LWW `ts` |
| `forceOnMic: bool` (AC3.4) | Per-part. | attributes | Own participant |
| `smartMicManaged`, `catchingUp`, `priorMicState` | Per-part. | local only | Own participant |

**Snapshot on join.** On `RoomEvent.Connected`, joiner broadcasts a `hello`
(RELIABLE). Any peer in-room > 500 ms replies via `publishData` with
`destinationIdentities: [joinerId]` (no fan-out). Reply carries the four
room-wide values plus responder `identity` + `roomJoinAt`. Joiner adopts
the snapshot from the earliest joiner (tie-break: lexicographic identity).
No response in 1.5 s → assume empty state (they're first).

**AC1.3 (initiator drop → auto-release ≤ 5s).** Every client watches
`RoomEvent.ParticipantDisconnected`. If departing identity === `held.by`,
locally clear the hold. Symmetric, no timer, no broadcast — every peer
observes the same event and derives the same result.

**AC3.5 force-on exit** (PM's chosen answer, adopted): the smart-mic
controller observes its own mic transitioning off while `forceOnMic ===
true`, then writes `forceOnMic = false` via `setAttributes`. Peers see the
change via `RoomEvent.ParticipantAttributesChanged`.

---

### 3. Buffer resilience / sync (AC2.x)

**Problem.** Detect a stalled screen-share subscription (AC2.1, ≥ 3s); auto-
resync within 5s (AC2.2); at > 20s, offer a **Catch up** button (AC2.4).
Local to the affected guest (AC2.3).

**Options.** (A) `TrackMuted` — wrong: it's a publisher-side signal. (B)
LiveKit `ConnectionQualityChanged` — coarse; can flip on unrelated bandwidth.
(C) `HTMLVideoElement.requestVideoFrameCallback` (rVFC) heartbeat on the
screen-share `<video>`; if no frame in ≥ 3000 ms, stalled.

**Decision — C, with B wired for logs only.**

- In `ScreenShareView`, install an rVFC loop that records `lastFrameAt`.
- 500-ms poll compares `performance.now() - lastFrameAt`:
  - ≥ 3000 ms → local `catchingUp = true`, render "Catching up…" (AC2.1).
  - Recovery (below 3000 ms after being stalled) → clear pill (AC2.2). For
    a live SFU stream this means the video element resumes at head-of-
    stream, which LiveKit adaptive-stream already delivers.
  - ≥ 20 s → `catchingUp = "stuck"`, render actionable button (AC2.4).
    Click handler re-attaches (`track.detach(el); track.attach(el)`) to
    force the video element to drop its buffer. If still stuck, call
    `publication.setSubscribed(false)` then `true` on the screen-share
    publication — SDP renegotiation for that track only.

**AC2.3 (local only).** No data-channel broadcast. Peers see nothing.

**What we don't do.** No seek on the underlying player (PM's explicit
"live-edge, not timestamp-precise" trade-off). If the host is on YouTube
and doesn't voluntarily pause, room-layer resync is all we get; Wait-for-Me
(§1/§2) is the escape hatch — the stalled guest holds, the host pauses.

**Rejected.** A is the wrong signal. B alone is too coarse; retained as a
diagnostic log line.

---

### 4. Audio ducking (Whisper mode, AC4.x)

**Problem.** Duck the shared-tab audio for everyone when any participant
speaks; fixed depth; voice + ~1s tail (AC4.1); movie stays audible (AC4.3).
Ducking is per-client output; trigger is room-wide (AC4.2).

**Options.** (A) `HTMLAudioElement.volume` — one line, but stepped, not
smooth. (B) **Web Audio graph** `MediaStreamAudioSourceNode → GainNode →
destination` with `linearRampToValueAtTime`. Standard duck. Works in
Chrome/Edge/Firefox; current Safari (17+) handles it. (C) Server-side
sidechain — not offered by LiveKit at our tier.

**Decision — B, with A as fallback.**

- On `TrackSubscribed` for `Track.Source.ScreenShareAudio`, detach the
  default `<audio>` LiveKit would attach and build the graph:
  `createMediaStreamSource(track.mediaStream) → duckGain (GainNode, 1.0)
  → destination`.
- **Duck depth: −12 dB** (gain ≈ 0.251). Broadcast standard; −6 dB too
  subtle, −18 dB approaches mute for quiet dialogue. Single constant,
  reviewable post-ship (see Open questions).
- **Attack 80 ms; release 400 ms; tail 1000 ms** (AC4.1). On VAD rising
  edge (§5): `linearRampToValueAtTime(0.251, ctx.currentTime + 0.08)`. On
  falling edge: start 1000-ms timer, then ramp back to 1.0 over 400 ms.
  Any rising edge during the tail cancels the timer.
- **Room-wide trigger.** Each participant runs local VAD on their own mic
  (§5). When `whisperOn === true`, VAD edges publish a
  `{ type: "whisper", phase: "voice-on" \| "voice-off" }` data-channel
  message (LOSSY — a missed edge just self-heals on the next one; also
  cheaper on the wire). Rate-limit local edges to one per 200 ms.
- **AC4.5 (OFF → Phase 1 mix).** Graph stays wired, `duckGain = 1.0`, VAD
  broadcasts suppressed.
- **AC4.6 (room toggle).** LWW state, §2.
- **Fallback.** Safari or graph-construction failure → `audioEl.volume =
  0.25` / `= 1.0` on the edges. If that also fails: disable the button
  (per PM mobile cross-cutting — show nothing over a broken control).

**Rejected.** A alone is choppy (fine as fallback). C out of reach.

---

### 5. Voice activity detection (Smart mic + Whisper trigger, AC3.x)

**Problem.** Two consumers: **Smart mic** (AC3.1) needs to know when the
shared-tab audio is playing; **Whisper** (AC4.4) needs to know when a
participant's own mic has voice. Same primitive, different sources.

**Options.** (A) **Roll our own** with `AnalyserNode.getFloatTimeDomainData`
+ RMS + debounce; ~50 LOC, zero deps. (B) `AudioWorklet` — off-main-thread,
more plumbing; Phase 3 if CPU shows up. (C) `@ricky0123/vad-web` — 1.5 MB
WASM neural VAD; overkill given AC4.4 accepts false positives.

**Decision — A, shared module for both consumers.**

- `MediaStreamAudioSourceNode → AnalyserNode (fftSize 2048)`; RMS over last
  25 ms; ~50 Hz sample loop off rAF.
- **Threshold: −40 dBFS** (`rms > 0.01`). Below room-tone, above silence.
  Module constant.
- **Whisper debounce (AC4.1):** rising after 80 ms continuous over, falling
  after 200 ms continuous under. The 1000-ms tail lives in §4.
- **Smart-mic trigger (AC3.1):** start = `ScreenShareAudio` track present
  *and* RMS over threshold for **1500 ms** continuously (catches "audio
  track present but silent still-frame" per AC3 edge). Stop = **track-end
  only** (`TrackUnpublished` on the ScreenShareAudio source). RMS-long-
  silence deliberately does **not** unmute — AC3 edge "host mutes the tab
  in-browser without stopping share → treat as still-active." (The RMS-
  silence signal *does* feed Cards' quiet signal in §7.)
- **Force-on (AC3.4–3.5).** VAD always runs. The smart-mic controller
  gates auto-mute actions on `forceOnMic === false` (§2). Force-on means
  "action suppressed," not "detection off."

**Rejected.** B, C as above.

---

### 6. Reactions overlay (AC5.x)

**Problem.** Four fixed emojis; float, fade in 3s (AC5.2); don't block
controls (AC5.3); no audio impact (AC5.4); 4-per-sender-per-3s (AC5.5);
`aria-label`ed (AC5.6).

**Options.** (A) **DOM spans + CSS transition** + `setTimeout` cleanup, ~60
LOC. (B) Canvas/WebGL — overkill. (C) `framer-motion` — package for what
CSS does; rejected per `CLAUDE.md`.

**Decision — A.**

- On click: local spawn + broadcast `reaction { emoji, id, name, ts }` on
  data channel (LOSSY per §1 — satisfies AC5.4).
- On receive: append to `reactions[]`; render as absolutely-positioned span
  in a full-stage overlay layer, z-index above ShareStage but *below*
  ActionBar (AC5.3). Overlay is `pointer-events: none` and `aria-hidden`.
- Lifecycle: spawn `x` random 10–90%, `y = 100%`; CSS transition
  `translateY(-100%)` + `opacity 0` over 3000 ms; drop from state after.
- **Rate limit (AC5.5).** Client-side per-sender ring buffer of last 4
  send timestamps; drop silently if the oldest is within 3000 ms. Same
  posture as `src/lib/rate-limit.ts`, tab-local. No queue.
- **AC5.6.** Single visually-hidden `role="status" aria-live="polite"
  aria-atomic="true"` div at room level. On received reaction: write
  "Sarushna reacted with 😂", clear after 100 ms so the next one fires.
  Same rate-limit as the visual layer.

**Rejected.** B, C fail the few-lines-of-code rule.

---

### 7. Mini Date Cards (AC6.x)

**Problem.** Prompt card at a "natural break"; Answer-together / Dismiss;
first dismiss wins (AC6.3); 5-min cooldown (AC6.4); toggle default ON
(AC6.5); doesn't cover mic/cam/Leave/reactions (AC6.6); keyboardable
(AC6.7).

**Prompt storage.** (A) Static JSON in repo (`src/lib/date-cards.ts`).
(B) API route — no content benefit at seed size. (C) CMS — absurd here.
→ **A**, seed of 25 prompts (PM's floor). Prompt id is `card.<index>`;
`currentCard` state (§2) carries the id, not the text — every client
renders the same prompt from local content. Content update = code change.
PM to review seed before ship (see Open questions).

**Break detection (AC6.2 — three signals; if none available, no fire).**

- **Hold active** → `held !== null` (§2).
- **All mics silent ≥ 45s** → combine local VAD (§5) with LiveKit
  `ActiveSpeakersChanged`. A 45-s timer resets on any speaker event or any
  local voice-on edge. When it fires locally, the client is a *candidate*
  proposer.
- **Shared audio quiet ≥ 45s** → §5 VAD on `ScreenShareAudio`. Same 45-s
  timer, same proposer flow.

**Proposal flow.** Only one card fires room-wide. Candidate proposer
publishes a `card { phase: "propose", id }` (RELIABLE); LWW on
`currentCard` guarantees exactly one wins even if two propose at the same
tick. Every client sets local `cardsCooldownUntil = Date.now() + 5*60*1000`
on dismiss; new proposals seen before then are ignored. Cooldown is
per-client — no need to replicate, since the LWW `currentCard` state does
the room-wide gate.

**Fallback (AC6.2 negative).** No signal → cards silently do not fire.
Toggle stays operable (AC6.5) but produces nothing until a signal returns.

**Rendering.** `role="dialog"` with `aria-labelledby`, focus-trapped, Escape
closes (AC6.7). Bottom-center of ShareStage, z-indexed above reactions,
`max-height` constrained so ActionBar remains uncovered (AC6.6). Mobile
constraint: never cover Leave.

**Rejected.** B, C fail the no-new-services driver.

---

### 8. Token permission fix

**Problem.** Phase 1's grant sets neither `canPublishData` nor
`canUpdateOwnMetadata`. `setName()` at `RoomClient.tsx:176` throws today.
Phase 2 needs the data channel and (per §2) participant attributes.

**Options.** (A) Grant **`canPublishData` + `canUpdateOwnMetadata`** — two-
line change to `mintAccessToken`; enables data channel, `setName`,
`setAttributes` (attributes ride the same grant as own-metadata). (B) Grant
`canPublishData` only, keep force-on in data channel — saves a grant, forces
a snapshot message on every join forever. (C) Skip `setName` by fixing the
root cause: accept `nickname` on `POST /api/rooms` and mint the host token
with `name` set from the start.

**Decision — A + C.**

- Grant `canPublishData: true` and `canUpdateOwnMetadata: true` in
  `mintAccessToken` (`src/lib/livekit/token.ts`).
- **Also** fix the Phase-1 root cause: `POST /api/rooms` accepts an optional
  `nickname` (same Zod validation as the join route) and, when present,
  the host token is minted with `name: nickname`. `RoomClient.tsx` drops
  the post-connect `setName` call. Belt-and-braces: `canUpdateOwnMetadata`
  covers future post-connect updates without another ADR.

**Consequence.** Trust envelope widens marginally — a stolen-token holder
can spam data messages and mutate own attributes. Both room-scoped,
bounded by client-side rate limits, no new server-side surface. Base case
is unchanged from ADR-0004: the room code is the capability.

**Rejected.** B is a false economy.

---

### 9. Testing & observability

**Unit-testable (Vitest, no browser).**

- **Envelope** (`src/lib/room/envelope.test.ts`): encoder + Zod validator
  round-trip; unknown `v` / unknown `type` dropped; malformed JSON logs
  and drops.
- **Rate limiter** (`src/lib/room/rate-limit.test.ts`): sender-side
  reaction limiter (AC5.5, 4/3s), card cooldown (AC6.4, 5-min).
- **VAD math** (`src/lib/room/vad.test.ts`): pure
  `computeVadEdges(samples, threshold, debounceMs)` — thresholds, hold-
  through, both debounce values. The `AnalyserNode` wrapper is a thin
  adapter over this.
- **LWW reducer** (`src/lib/room/state.test.ts`): `applyEvent(state,
  event)` per type; older-`ts` events don't override newer; hold auto-
  release on participant-disconnect.
- **Cards state machine**: 45-s silence timers, proposal LWW, cooldown
  with a fake clock.

**Two-browser E2E (Playwright, Phase-1 QA posture).**

- Reaction delivery (LOSSY: at least one of N lands; AC5.5 enforced).
- Hold banner on both stages within 2s (AC1.1).
- Whisper duck audibly attenuates: synth sine tones on both mics, assert
  `duckGain.gain.value` via a dev-only debug hook.
- Smart-mic auto-mute on tab-share-with-audio, restore on stop
  (AC3.1–3.2).
- Card dismissal propagates within 2s (AC6.3).
- Token fix: `setName` no longer throws (Phase-1 regression gate).

**Observability.** Structured log on every data-channel drop (unknown
type, version mismatch, Zod fail); per-session counters emitted on
disconnect. Dev-only `console.info` on VAD edges, duck engagement,
smart-mic actions. Metric counters (reactions sent/received/dropped, holds,
whisper toggles, cards shown/dismissed, catch-up entries + durations)
follow ADR-0003's posture — structured logs, no new infra. Sentry
remains deferred (same trigger as ADR-0002–0004).

---

## Decision (summary)

Phase 2 ships on the LiveKit primitives already open. Data channel (§1) =
event transport; participant attributes (§1, §8) = durable per-participant
state; room-wide state is event-sourced with LWW + snapshot-on-join (§2).
Web Audio graph on `ScreenShareAudio` for ducking (§4); shared RMS VAD
module for Smart-mic and Whisper triggers (§5); rVFC heartbeat on the
screen-share video element for buffer stall detection (§3). Reactions are
DOM + CSS (§6). Cards are a static seed with LWW-arbitrated proposal (§7).
Token widens to `canPublishData` + `canUpdateOwnMetadata`; the Phase-1
`setName` bug is root-caused at mint-time (§8).

No new packages. No new services. No DB. PM ordering (5 → 1 → 3 → 2 → 4 →
6) preserved; §1 lands ahead of it because every feature consumes it.

## Consequences

**Locks in**

- **LiveKit data channel is the Phase-2 signaling substrate.** Any future
  feature that needs to broadcast state (playback sync, text chat, host
  handoff signaling) inherits the same envelope. New `type`s bump the
  payload spec but not the transport.
- **LWW-with-snapshot as the room-state model.** No consensus, no leader.
  Adding a feature with more-complex conflict rules (say, a shared
  timeline) will need to revisit this — but every Phase 2 feature is
  either single-writer-per-toggle or event-y, and this model fits.
- **Web Audio graph in front of every remote `ScreenShareAudio` track.**
  Any future audio feature (loudness normalization, per-participant
  volume) drops into the same node chain.
- **RMS-threshold VAD.** Good enough per AC4.4. If we ever need speaker
  diarization or "distinguish laughter from words," we replace this with
  Silero via `@ricky0123/vad-web` or an AudioWorklet — bounded to the
  file it lives in.
- **Token grant now includes `canPublishData` and `canUpdateOwnMetadata`.**
  Any participant with a valid token can spam the room's data channel
  and their own attributes; bounded by client-side rate limits and the
  room's overall lifespan (10-min idle grace + LiveKit's session).

**Forecloses**

- **No server-side authority over room state.** If we ever need a
  moderator (kick/mute-other, PM non-goal today), the LWW model doesn't
  help — that path needs either host-signed events or a server-side
  RoomService write path. New ADR.
- **No cross-tab or cross-room state.** Cards' cooldown, force-on mic,
  and every LWW value is per-room-instance. A user who leaves and
  rejoins the same code starts fresh.
- **No true playback sync.** Wait-for-Me relies on the host voluntarily
  pausing the underlying tab. If the user later wants "seek together"
  or "start together at 00:00", that's a new architecture (either the
  Hyperbeam-style co-browser path from ADR-0004's alternatives, or a
  per-player integration — YouTube IFrame API, Twitch Embed API — which
  is explicitly out of scope per the PM spec's Out-of-scope list).
- **No text chat via this ADR.** The `ChatPanel` in `RoomClient.tsx` is
  still a visual mock. Enabling it would be a trivial addition to the
  envelope (`type: "chat"`, RELIABLE) but is not part of Phase 2's six
  features.

**Defers**

- Sentry / structured error tracker — same trigger as ADR-0002 through
  0004. Phase 2 does not move it.
- Shared rate-limit store (Vercel KV / Upstash Redis) — same trigger as
  ADR-0004. Phase 2 adds only client-side rate limiters; no new
  server-side surface to protect.
- `AudioWorklet`-based VAD — if CPU on low-end devices shows up as an
  issue in real usage.
- Neural-VAD dependency — same trigger.

## Alternatives considered (roll-up, cross-ref to sections)

Rejected: separate signaling stack (§1), host-authoritative or metadata-
as-truth state (§1–2), `TrackMuted` for stall detection (§3), server-side
sidechain (§4), neural VAD (§5), canvas/`framer-motion` reactions (§6),
API-served card content (§7), minimal-token that keeps the `setName` bug
(§8).

## Open questions for PM / user before specialists start

1. **Duck depth = −12 dB, confirm or override.** Broadcast-standard, but
   the user's preference on how loud the movie stays during whisper is a
   product call. Easy to tune post-ship.
2. **Card seed set (25 prompts) — PM to draft or approve.** PM's Open
   items already flags this. Blocks the Cards specialist (feature 6);
   does not block features 1–5.
3. **Force-on exit criterion (AC3.5).** PM Open item; ADR assumes the
   PM's own chosen answer ("explicit mic-off returns to smart-managed").
   Confirm.
4. **Screen-reader announcement copy for reactions (AC5.6).** ADR uses
   "Sarushna reacted with 😂" template. Any i18n / phrasing preference?
5. **Rate-limit values (AC5.5: 4/3s; AC6.4: 5min).** Seed values from PM;
   confirm before the reactions and cards specialists wire them in as
   constants.
