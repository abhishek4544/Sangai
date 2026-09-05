# W-P2 — Watch-together Phase 2 (in-room feel)

**Status:** Draft
**Milestone:** W-P2 (follows W-MVP)
**Owner:** Product

## Purpose / problem

Phase 1 (`watch-together-mvp.md`) shipped the room: 2–4 people join a short
code, talk, and one person shares a browser tab. The room works but watching
*together* still doesn't feel like it — one side buffers and the other keeps
going, mics stay open through tense scenes, someone laughs and it lands three
seconds later, boring stretches turn into awkward silence. Phase 1's shell
already renders six behavior buttons (`RoomClient.tsx` — Wait for me, Mini
Date Cards, Look at me, Whisper mode, and the reaction row) with no behavior
attached. Phase 2 wires them so the room feels like a couch, not a video call
with a movie playing. The design frame is a two-person couple; 3–4 must still
work (per Phase 1 AC3) but is not the optimization target.

## In scope

Six features, no more: **Wait for Me**, **Buffer resilience**, **Smart mic +
auto-mute**, **Whisper mode**, **Live reactions**, **Mini Date Cards**.

## Out of scope

- **Netflix / Prime / Disney+ / HBO Max playback.** Still a black frame on
  the guest side. Every Phase 2 feature that touches playback or audio
  assumes a non-DRM tab. The Phase 1 DRM warning (AC7) covers this; no new
  warning.
- **Underlying player integration.** We do not talk to YouTube's / Twitch's /
  X's players via their JS APIs. Everything operates at the room layer.
- **Host handoff / guest-as-sharer, text chat, recording, transcripts,
  captions, kick/mute-other, native mobile layouts.** Same posture as
  Phase 1.
- **Movie recommender surfaces.** Parked per `CLAUDE.md`.

---

### 1. Wait for Me

**Goal.** One-click "hold the movie" that pauses the shared experience for
everyone until the initiator resumes.

**User story.** As a viewer, I want a Hold-for-Me button that pauses the
movie for both of us and shows my partner I stepped away.

**Acceptance criteria.**
- **AC1.1** Any participant clicks **Hold for Me**. Within 2s (warm
  connection), the shared tab's playback effectively stops for every
  participant and a "Held by <nickname>" banner appears on every stage.
- **AC1.2** The initiator (only) sees **Resume** in the same spot. Clicking
  releases the hold and clears the banner for everyone within 2s.
- **AC1.3** If the initiator leaves or disconnects while a hold is active,
  the hold auto-releases within 5s for remaining participants. Nobody is
  stuck.
- **AC1.4** The banner names the initiator's nickname.
- **AC1.5** Non-initiators see the button in a disabled "Held by
  <nickname>" state. One hold at a time; no queue.

**Edge cases.** DRM tab → banner still fires but the movie doesn't visibly
pause (Phase 1 DRM warning covers). Fast double-clicks are debounced. Last
person left is the initiator → Resume is available, no banner.

**Non-goals.** No timed holds. No "anyone can lift any hold." No integration
with underlying player APIs.

### 2. Buffer resilience

**Goal.** When one side's connection stutters and their shared-stream view
falls behind, they auto-catch-up rather than watching 8-second-old frames
for the rest of the movie.

**User story.** As the guest, when my internet stutters, I want my view to
snap back to what the host is currently showing once my connection returns.

**Acceptance criteria.**
- **AC2.1** When a guest's screen-share subscription has no new frames for
  ≥ 3s while the host is still publishing, a lightweight "Catching up…"
  indicator appears on that guest's stage only.
- **AC2.2** Within 5s of connection recovery, the guest's view
  resynchronizes to the live edge of the shared stream. "Current position"
  means the live edge, not a timestamp inside the underlying player.
- **AC2.3** Catch-up is local to the affected guest. Other participants
  see nothing — no banner, no jump, no interruption.
- **AC2.4** If the stall exceeds 20s, auto-catch-up stops and an actionable
  "You're a long way behind — click to catch up" message with a **Catch up**
  button is shown to that guest.
- **AC2.5** Voice and camera streams are not part of catch-up. Late voice
  is dropped, not queued.

**Edge cases.** Both sides buffer simultaneously → both catch up when
upstream recovers. Host is the one buffering → guests just see a still
frame together (correct). DRM tab → indicator may misfire; acceptable
corner.

**Non-goals.** No user-controlled buffer size. No cross-tab timeline sync.
No historical replay of missed seconds.

### 3. Smart mic + auto-mute

**Goal.** Stop the "mic has been on the whole movie picking up your
keyboard" problem, without making mute feel like it's fighting the user.

**User story.** As a viewer, when the movie starts, I want my mic to mute
itself. When I want to talk, I want a one-tap "keep me on" override.

**Acceptance criteria.**
- **AC3.1** When the host starts sharing a tab **with audio**, every
  participant's mic auto-mutes within 3s. A toast ("Your mic was muted
  because the movie started") auto-dismisses in 4s. Prior mic state is
  remembered.
- **AC3.2** When the host stops sharing (or the shared audio track ends),
  every participant whose mic was auto-muted has their mic restored to
  its prior state within 3s. Already-muted participants stay muted.
- **AC3.3** The mic tile shows a **Smart mic** indicator when auto-mute
  is currently managing that participant.
- **AC3.4** **Force on** override: clicking the mic toggle while smart-
  muted un-mutes and suppresses auto-mute for that participant for the
  rest of the session. Indicator changes to Force-on.
- **AC3.5** A Force-on participant who then manually toggles mic off
  returns to smart-managed. "Force on" and "smart-managed" are a single
  binary.
- **AC3.6** Smart mic never publishes audio that was previously muted —
  "prior state" means state, not unconditional un-mute.

**Edge cases.** Share with no audio → do not fire (trigger is "audio
started," not "share started"). Host mutes the tab in-browser without
stopping share → treat as still-active; don't un-mute everyone. Very short
share (< toast duration) → suppress toast.

**Non-goals.** No voice-activity ducking of participant's own mic (that's
Whisper). No per-participant customization beyond Force on/off. No auto-mute
in rooms with no share.

### 4. Whisper mode

**Goal.** Handle "one important line, one comment from my partner" — the
movie stays running, audio dips for the beat, then comes back.

**User story.** As a viewer, when my partner speaks during a scene, I want
the movie's audio to briefly duck so I can hear her, without pausing.

**Acceptance criteria.**
- **AC4.1** A **Whisper mode** toggle in the action bar. When ON, voice-
  activity on any mic ducks the shared tab's audio by a fixed amount for
  the duration of the voice plus a ~1s tail.
- **AC4.2** Ducking is applied for every participant, so both sides hear
  the movie quieten in sync when one talks.
- **AC4.3** Ducking is a volume reduction, not a mute. The movie remains
  audible throughout.
- **AC4.4** Trigger is voice activity, not push-to-talk. Occasional false
  positives (laughter, keyboard) are acceptable in exchange for zero
  friction.
- **AC4.5** With Whisper mode OFF, mic and movie audio mix at normal
  levels (Phase 1 behavior).
- **AC4.6** Whisper mode is room-wide. Any participant can toggle it;
  everyone's mix reflects the change.

**Edge cases.** All mics off → no-op, toggle still operable. Smart mic
has auto-muted everyone → Whisper is dormant until someone un-mutes; the
two features layer cleanly. Share with no audio → nothing to duck.

**Non-goals.** No per-participant duck amount. No sidechain / broadcast
dynamics. No pausing as fallback — the point is that it doesn't pause.

### 5. Live reactions

**Goal.** Restore the "I heard my partner laugh" beat. Visible reaction,
non-interrupting.

**User story.** As a viewer, when something funny happens, I want to hit a
laugh button and have my partner see me laugh, without unmuting or pausing.

**Acceptance criteria.**
- **AC5.1** Every participant has a fixed emoji set — **😂 ❤️ 😭 🔥** — in
  the action bar. Clicking sends a reaction to every participant.
- **AC5.2** A received reaction renders as a floating emoji that animates
  and auto-dismisses within 3s. No action required to clear.
- **AC5.3** Reactions never block or overlay a UI control. They pass under
  buttons and are `aria-hidden` for assistive tech (except AC5.6).
- **AC5.4** Reactions do not pause, duck, or affect audio.
- **AC5.5** Sender-side rate limit: **4 reactions per participant per 3s**;
  extras are silently dropped, not queued.
- **AC5.6** Reactions carry sender identity via an `aria-label`
  ("Sarushna reacted with 😂") announced once per reaction to screen
  readers.

**Edge cases.** Reactions during a hold → still fire (valid). Reactions
over a DRM black frame → render over black; fine. Everyone reacting at
once → stagger visually; all four deliver.

**Non-goals.** No custom emoji / picker beyond the fixed four. No
reaction history. No reaction sounds. No text messages on the reactions
channel.

### 6. Mini Date Cards

**Goal.** Turn boring stretches into a lightweight together-moment.
Optional prompt cards at natural breaks, dismissible on both sides.

**User story.** As a couple watching long-distance, when a scene drags,
I want the room to offer us a fun prompt we can answer together, or
disappear on its own if we ignore it.

**Acceptance criteria.**
- **AC6.1** A card shows a short prompt (silly question / either-or /
  would-you-rather) with two affordances: **Answer together** and
  **Dismiss**.
- **AC6.2** "Natural break" fires only when: a hold is active, **or**
  voice-activity has been zero across all mics for ≥ 45s, **or** the
  shared audio has been quiet for ≥ 45s. If none of those signals are
  available (see Open items), cards do not fire.
- **AC6.3** Any participant clicking **Dismiss** removes the card for
  everyone within 2s. **Answer together** keeps it visible; a second
  click from either participant on the same card dismisses.
- **AC6.4** No more than one card on-screen at a time. **≥ 5-minute
  cooldown** after dismissal before another can fire, regardless of
  break signals.
- **AC6.5** A **Mini Date Cards** toggle in the room UI, **default ON**,
  suppresses cards session-wide when off. Room-scoped, same shape as
  AC4.6. Turning off dismisses any visible card.
- **AC6.6** Cards do not cover the mic/cam toggles, Leave, or the
  reaction row.
- **AC6.7** Escape dismisses when focused. Both buttons are keyboard-
  reachable.

**Edge cases.** 3–4-person rooms → any single participant dismisses for
everyone (coordinating dismissal across four people would kill the
feature; another card is ≤ 5min away). Card mid-scene when a loud beat
lands → no auto-dismiss on audio return; ignore it or click Dismiss.
DRM tab → break signal is unreliable; may misfire, not worth engineering
around.

**Non-goals.** No user-generated prompts, no prompt-library UI, no card
ratings. No AI-generated / scene-aware prompts. No text-input answers —
answering is verbal, that's the whole point.

---

## Cross-cutting concerns

- **Room-scoped state.** Hold state (AC1.x), Whisper toggle (AC4.6), Mini
  Date Cards toggle (AC6.5), currently-visible card (AC6.4). Any
  participant's change is visible to all within 2s.
- **Per-participant state.** Smart mic managed/Force-on (AC3.3–5), local
  "catching up" (AC2.1), mic muted/un-muted.
- **DRM interaction.** Netflix/Prime/Disney+/HBO Max still render as a
  black frame on the guest side. Wait for Me, buffer sync, Whisper,
  Smart mic (audio-triggered), and Mini Date Cards' audio-quiet signal
  assume a non-DRM tab. Phase 1's AC7 warning carries; no new copy. Do
  not fingerprint the shared tab.
- **Accessibility.** All new controls are keyboard-reachable with visible
  focus and `aria-pressed` where applicable. Reactions are `aria-hidden`
  except AC5.6. Auto-mute (AC3.1), catching-up (AC2.1), and hold banner
  (AC1.1) fire polite live-region announcements. Cards are dialog-shaped
  (labeled, focus-trapped, Escape closes — AC6.7).
- **Mobile behavior.** Desktop-first still (Phase 1 out-of-scope holds).
  On mobile: reactions and Wait for Me can render at reduced fidelity;
  Smart mic and Whisper may be disabled if the audio-graph hooks aren't
  reliable (show nothing rather than a broken button); Date Cards must
  not cover Leave.

## Prioritization

Ship in this order:

1. **Live reactions (5).** Lowest risk, highest felt-difference-per-LoC,
   touches no audio pipeline, UI row already exists (`ReactionBar`).
2. **Wait for Me (1).** Room-state feature, no audio work, button already
   in `ActionBar`. Most explicitly asked for.
3. **Smart mic + auto-mute (3).** Detects "movie audio playing" but
   doesn't modify audio. Fixes a real embarrassment.
4. **Buffer resilience (2).** Real media-plumbing; ship after smart mic
   because it's more infra, less felt.
5. **Whisper mode (4).** Actual audio-graph ducking. Ships after smart
   mic, which teaches us the detection side of the plumbing.
6. **Mini Date Cards (6).** Consumes signals from 3 and 4; also a
   content problem. Ships last.

**Bias.** Features 1, 3, 5 don't require the host to change any code path
they already understand — they press the same **Share tab** button and new
behavior wraps around them. If Phase 2 must be halved, ship 1, 3, 5 and
defer 2, 4, 6.

## Explicit trade-offs locked with the user

- **DRM is still a black frame; we do not work around it.** Same trade as
  Phase 1. Audio-triggered features (3, 4, 6) work only on non-DRM tabs.
- **Room-wide toggles are last-writer-wins.** No voting UI.
- **Reaction spam is soft-capped (AC5.5), not hard-blocked.**
- **Wait for Me operates at the room layer, not the underlying player.**
  If this doesn't match user intent, escalate.
- **Buffer catch-up is live-edge, not timestamp-precise.** We can't seek
  an arbitrary player.
- **Force on is per-session, not persistent across rooms.** No settings
  storage.
- **Mini Date Cards is on by default (AC6.5).** Off-by-default kills it.
- **All six features degrade to no-op, never error.** If a signal isn't
  available, the feature silently doesn't fire — no warning, no disabled
  button.

## Open items — for tech-lead ADR

- **Room-wide state transport.** Hold banner, Whisper toggle, Cards toggle,
  reactions, catch-up hints all need a low-latency delivery channel.
  ADR 0004 deferred `canPublishData` "if text chat or playback sync
  lands." That trigger is now met by AC1.1, AC4.6, AC5.1, AC6.5. Choose:
  LiveKit data channel vs participant attributes vs room metadata.
- **Sync approach: heartbeat vs on-event.** Do we broadcast state changes
  as events and derive locally, or does one participant hold the source
  of truth?
- **Detecting "movie audio started" (AC3.1) and "quiet for 45s" (AC6.2).**
  What CPU cost / false-positive rate does metering `ScreenShareAudio`
  incur? If infeasible: AC3.1 falls back to "audio track present" and
  AC6.2 degrades to hold-state-only.
- **Ducking mechanism (AC4.1).** Per-client gain on the shared-audio track,
  or a room-wide ducking signal each client honors? Related to the
  transport question.
- **Catch-up mechanism (AC2.2).** How much of this is LiveKit's built-in
  adaptive-stream behavior vs an explicit re-subscribe on stall? May be
  no-code once we understand the defaults.
- **Prompt pool for Date Cards (AC6.1).** Where does the content live,
  how large is the seed set, does the user want to review before ship?
  Seed of ~25 prompts is the floor for a launch.
- **Rate-limit values.** AC5.5 (4 per 3s) and AC6.4 (5-min cooldown) are
  seed values — confirm or let usage set them.
- **Force on exit criterion (AC3.5).** Chosen: explicit mic-off returns to
  smart-managed. Confirm — or should Force on persist until end-of-session
  no matter what.
