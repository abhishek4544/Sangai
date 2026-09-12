# Watch Mode — v1.1

**Status:** Proposed
**Milestone:** v1.1 (follows W-MVP; ships after W5 review passes)
**Owner:** Product
**Depends on:** `docs/product/features/watch-together-mvp.md` (W-MVP) shipped and merged.

## Overview

An additive mode inside `/room/[code]` that lets any participant paste a
supported video URL and have every participant play that video **natively in
their own browser**, with play/pause/seek synchronized over the LiveKit data
channel. Screen-share stays available as the escape hatch. Watch Mode is
YouTube-only on day one; the provider layer must be shaped so adding
Twitch/Vimeo/etc. later is not a refactor.

## Problem

The base MVP relies on screen-sharing a browser tab with audio. In real
sessions the user has hit four failure modes that are structural, not bugs:

1. **Users forget to tick "Share tab audio"** in the browser picker (or share
   a *window* instead of a *tab*, which has no audio path at all). Guests see
   video with no sound.
2. **Firefox and Safari cannot capture tab audio** in `getDisplayMedia`. On
   those browsers the audio path is unreachable no matter what the host does.
3. **DRM sites (Netflix / Prime / Disney+ / HBO Max)** render a black frame on
   the guest side. Called out in W-MVP AC7; not a bug, not fixable at the
   screen-share layer.
4. **The host has to babysit the tab.** Switching tabs, opening a new tab in
   the shared window, or minimizing breaks the experience for guests.

The through-line: screen-share turns one user's browser tab into a
video-encode pipeline for everyone else. Every failure mode above is a
consequence of that pipeline being fragile, browser-gated, or DRM-blocked.
Watch Mode sidesteps it: each participant plays the video themselves, we only
sync when to play/pause/seek.

## User personas

Same personas as W-MVP (`docs/product/features/watch-together-mvp.md`) —
long-distance partner (host), long-distance partner (joiner), casual friend
group. No new persona; Watch Mode changes the mechanism, not who's in the room.

## User stories

- **US1 — Zero-setup audio.** As a host, I want to paste a YouTube URL and
  have everyone hear the audio without anyone toggling picker checkboxes, so
  that we don't lose the first two minutes of the video to "wait, can you
  hear it?"
- **US2 — Anyone can drive.** As a guest, I want to hit pause when I have to
  grab a drink and have it pause for everyone, so that the host doesn't have
  to be the remote.
- **US3 — Late arrival catches up.** As a guest joining a room mid-session, I
  want to land already synced to the current playhead and play/pause state,
  so that I don't miss what everyone is reacting to and don't have to ask
  "where are you at?"
- **US4 — Firefox/Safari works.** As a host on Firefox or Safari, I want to
  start Watch Mode from a URL, so that I can host a session on a browser
  that can't share tab audio at all.
- **US5 — Clear escape hatch.** As a host trying to watch something on
  Netflix, I want the UI to tell me plainly that Watch Mode won't help and
  that screen-share is my only path (and will still show a black frame for
  DRM), so that I don't waste time pasting URLs that will never work.

## In scope (v1.1)

- A **Watch Mode** control in `/room/[code]` visible to every participant.
- A **paste-a-URL** input that accepts a YouTube URL (watch, `youtu.be`,
  shorts, embed forms — the provider normalizes them).
- YouTube IFrame Player rendered in the room UI for every participant when
  Watch Mode is active.
- **Play / pause / seek sync** across all participants via the LiveKit data
  channel, tolerant of the leader's own echo.
- **Late-joiner catch-up:** a participant joining an active Watch Mode room
  loads the same video, seeks to the current playhead, and matches
  play/pause state on their first render.
- **Stop Watch Mode** control that clears the video for everyone and returns
  the room to voice + video (+ optional screen-share) only.
- **Provider registry** shaped so the file that lists supported providers is
  a small map (id → matcher + embed component + sync adapter). Day one ships
  one entry (YouTube). Adding Twitch / Vimeo / SoundCloud / Spotify / a
  generic iframe fallback later must be a new registry entry, **not** a
  refactor of the sync layer or the room UI.
- **DRM copy** on the URL input: "Netflix, Prime, Disney+ and HBO won't work
  here — use Share a tab instead (guests will still see a black frame; that's
  a browser DRM restriction)."
- **Screen-share coexists.** Watch Mode does not remove or hide the Share a
  tab control. A room can be in Watch Mode *or* screen-share, not both — the
  UI disables the inactive path while the other is running.

## Out of scope (explicit — do not sneak these into v1.1)

- **Any provider other than YouTube.** Twitch, Vimeo, SoundCloud, Spotify,
  generic-iframe: architecture supports them, day one doesn't ship them.
- **Netflix / Prime / Disney+ / HBO Max / any DRM-gated service.** No free
  path exists. Watch Mode will not attempt these; screen-share stays as the
  documented escape hatch and it will still show a black frame per W-MVP AC7.
- **Playlists, queues, "up next", auto-advance.** One video at a time.
  Advancing means someone pastes a new URL.
- **Per-participant volume mixing / karaoke / captions overlays.** The native
  YouTube player controls the video; we don't reskin it.
- **Persistent playback history, resume-where-we-left-off, saved rooms.** No
  DB, same posture as W-MVP.
- **Playback-rate sync (1.25x, 2x).** Sync only covers play/pause/seek in
  v1.1. Rate can land later without breaking the wire format.
- **Handling of live streams / DVR windows.** YouTube live works only insofar
  as play/pause on a live edge is meaningful; seek inside a live DVR window
  is not a v1.1 target.
- **Text chat, reactions, or any UI unrelated to the video surface.**
  (Reactions live in the W-P2 phase-2 spec, not here.)
- **Mobile-optimized layouts.** Desktop-first, same as W-MVP.

## Acceptance criteria

Sync-tolerance targets below are the working values. They come from two
constraints: LiveKit data-channel round-trip is typically under 150 ms on the
free tier, and the YouTube IFrame API's `seekTo` + `playVideo` sequence has
its own settle time of a few hundred ms. **±500 ms for play/pause** gives
enough headroom that "everyone reacted to the joke together" holds up
subjectively. **<1.5 s drift after a seek** is the point at which two
viewers watching the same shot are still in the same shot.

### AC1 — Start Watch Mode from a YouTube URL
**Given** a participant is inside `/room/[code]` and no one is currently
screen-sharing
**When** they open **Watch Mode**, paste a valid YouTube URL, and confirm
**Then** every participant in the room sees the YouTube player load with
that video within 3 seconds on a warm connection, hears the video's audio
natively in their own browser, and no one was prompted to tick "Share tab
audio" or grant any additional permission. An invalid or unsupported URL
shows a plain "That URL isn't supported yet — YouTube only for now" message
and does not change room state for anyone else.

### AC2 — Play/pause syncs across all participants
**Given** Watch Mode is active with a video loaded and every participant
sees the player
**When** any participant clicks play or pause on their own player
**Then** every other participant's player reflects the same state within
**500 ms** median (measured from the acting client's event to the receiving
client's state change), and the acting participant's own player does not
double-toggle from its own echo on the data channel.

### AC3 — Seek syncs across all participants
**Given** Watch Mode is active and the video is playing
**When** any participant scrubs to a new position on their own player
**Then** every other participant's playhead is within **1.5 s** of the
scrubbed position within 2 seconds of the seek event, and playback resumes
in the same play/pause state it was in before the seek.

### AC4 — Late joiner catches up on first render
**Given** Watch Mode is already active in a room (video loaded, current
playhead ≥ 30 s in, state = playing)
**When** a new participant joins the room with a valid code
**Then** on their first render of the room UI, the same YouTube video is
loaded, the playhead is within **1.5 s** of the current room playhead, and
their local play/pause state matches the room's within **500 ms** of first
render. They do not need to click anything to catch up.

### AC5 — Firefox and Safari hosts can start Watch Mode
**Given** a participant is on the latest stable Firefox or Safari on desktop
**When** they attempt to start Watch Mode with a YouTube URL
**Then** the flow succeeds end-to-end with the same sync behavior as
Chrome/Edge (AC1–AC3). The "Share a tab" control on the same browsers may
remain unavailable or degraded — that is a W-MVP limitation, not a Watch
Mode failure.

### AC6 — Stopping Watch Mode returns the room to base state
**Given** Watch Mode is active
**When** any participant clicks **Stop Watch Mode**
**Then** the player is removed from every participant's UI within 2 seconds,
voice + video continues uninterrupted, the **Share a tab** control becomes
available again for every participant, and the URL input is reset so the
next Watch Mode session starts fresh.

### AC7 — Watch Mode and screen-share are mutually exclusive
**Given** either Watch Mode or **Share a tab** is currently active
**When** any participant looks at the other control
**Then** that control is visibly disabled with a short reason ("Someone is
screen-sharing — stop that first" or "Watch Mode is active — stop it
first"). Starting the disabled path without first stopping the active one
is not possible from the UI.

### AC8 — DRM copy is unmissable at the URL input
**Given** a participant opens the Watch Mode URL input for the first time
in their session
**When** the input renders
**Then** a short notice appears next to it: "Netflix, Prime, Disney+ and
HBO won't work here. Use Share a tab for those (guests will see a black
frame — that's a browser DRM restriction, not a bug)." The notice is
present on every first-open in the session; it does not have to be blocking.

### AC9 — Provider registry pattern is honored
**Given** the codebase after v1.1 ships
**When** an engineer adds a second provider (e.g. Twitch)
**Then** the change is a new entry in the provider registry (URL matcher,
embed component, sync adapter implementing the same interface used by the
YouTube adapter) plus tests, with no edits required to the room UI, the
LiveKit data-channel message shape, or the late-joiner catch-up path.
This is checked at review time, not at runtime — it's a code-shape
acceptance, called out here because "day one YouTube, day two more" is a
product commitment the architecture must not betray.

## Success metrics

Measured against real sessions in the first 30 days after v1.1 ships.

- **Primary — Watch Mode is the default watch path when it's usable.**
  ≥ **60 %** of room-minutes where someone is watching something together
  are Watch Mode minutes (vs. screen-share minutes), for rooms watching
  content on a Watch-Mode-supported provider. If Watch Mode ships and
  screen-share stays dominant even for YouTube, the mode isn't earning its
  weight.
- **Secondary — the "no audio" pain drops.** Post-session ask ("did audio
  work?") returns **zero** "no audio for guest" reports across Watch Mode
  sessions in the first 30 days. One or more such reports is a
  regression-level signal — Watch Mode's entire reason to exist is to make
  guest audio non-negotiable.
- **Provider-expansion signal.** Within **3 months** of v1.1 shipping, at
  least **one additional provider** is added via the registry pattern
  (AC9) without touching the sync layer or room UI. If no second provider
  lands in 3 months and users are still asking for one, either the
  registry pattern isn't as extension-friendly as intended (revisit) or
  YouTube alone covers demand (also useful signal — deprioritize).

## Sequencing

Watch Mode depends on the base W-MVP shipping and passing W5 review:

- **W3 done** — `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` in
  place, `POST /api/rooms`, `POST /api/rooms/[code]/join` live.
- **W4 done** — `/` (create + join) and `/room/[code]` (LiveKit voice +
  video + Share a tab) shipped and functional.
- **W5 done** — QA + security + code review passed on the base MVP.

Only then does v1.1 start. Rationale: sync bugs and provider-embed quirks
are much easier to isolate on top of a stable room shell than to debug
inside a shell that itself isn't validated. Watch Mode also needs the
LiveKit data channel to be reliable in-room, which is a base-MVP property
we should not be discovering-and-fixing at the same time as building a new
UI on top of it.

## Open questions

1. **`canPublishData` on the base-MVP token grant.** Watch Mode rides on the
   LiveKit data channel. ADR 0004 §"LiveKit token — scope + TTL" sets
   `canPublishData: false` for the W-MVP token, and ADR 0005 §8 notes the
   same grant needs to flip on for W-P2 anyway. Confirm the tech-lead flips
   `canPublishData: true` as part of whichever milestone lands first (W-P2
   or v1.1) so Watch Mode doesn't have to re-litigate the grant.
2. **Sync leader model.** Two viable shapes: (a) *last writer wins* — every
   participant is a peer, any play/pause/seek broadcasts, and clients treat
   their own echo as a no-op via a client-generated event id; (b) *elected
   leader* — one participant (the one who started Watch Mode, or the room
   host if that concept survives) is authoritative and others send
   "requests." (a) is simpler and matches "anyone can drive" (US2); (b) is
   more resilient to conflict storms. Recommend (a) for v1.1; flag if
   tech-lead sees a reason to prefer (b).
3. **What is a "valid" YouTube URL.** The URL matcher must accept
   `youtube.com/watch?v=...`, `youtu.be/...`, `youtube.com/shorts/...`, and
   the `youtube.com/embed/...` embed form. Confirm this list is exhaustive
   for v1.1; excluding one is fine as long as it's explicit.
4. **Age-gated / region-locked / embed-disabled videos.** YouTube's IFrame
   Player will refuse to play some videos (uploader disabled embedding, age
   restriction, region lock). Product expectation for v1.1: fail plainly
   with "YouTube won't let this video play embedded — try another link,"
   not silently. Confirm this copy line and where it renders (per-viewer,
   or broadcast to the room?).
5. **Behavior when the participant who started Watch Mode leaves.** Watch
   Mode is a room-level state — it should keep running for the remaining
   participants. Confirm this matches expectation, or flag if there's a
   reason to end Watch Mode when its initiator leaves.
6. **Stop Watch Mode permissions.** AC6 says "any participant." Confirm
   this matches the "anyone can drive" posture, or if only the initiator
   should be able to stop it (analogous to the base-MVP "host-only
   screen-share" gate that was already relaxed on 2026-09-05 per
   `CLAUDE.md`).
